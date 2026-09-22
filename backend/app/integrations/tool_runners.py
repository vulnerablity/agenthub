# integrations/tool_runners.py
# 工具执行器注册表（tool-calling.md 2.4）：calculator（ast 白名单安全求值）与 http（通用 webhook + SSRF 基础防护）
# 职责边界：纯基础设施组件，不依赖 FastAPI / 不写库；执行结果统一为 ToolResult，异常不外抛（D11）
import ast
import ipaddress
import json
import socket
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.parse import urlparse

import httpx

from app.models import Tool

# 响应截断上限（防超大响应倒灌 LLM 上下文，tool-calling.md 2.4）
MAX_OUTPUT_CHARS = 8000

# calculator 白名单（tool-calling.md 2.4）
SAFE_BINOPS = {ast.Add, ast.Sub, ast.Mult, ast.Div, ast.FloorDiv, ast.Mod, ast.Pow}
SAFE_UNARYOPS = {ast.UAdd, ast.USub}
SAFE_FUNCS: dict[str, Any] = {
    "abs": abs,
    "round": round,
    "min": min,
    "max": max,
}
HTTP_METHODS = {"GET", "POST", "PUT", "PATCH", "DELETE"}


@dataclass
class ToolResult:
    """执行结果统一结构：status=ok/error，错误不抛出（D11）"""

    output: str
    status: str = "ok"
    error: str | None = None

    @classmethod
    def failed(cls, message: str) -> "ToolResult":
        return cls(output="", status="error", error=message)


class ToolRunner(Protocol):
    async def run(self, config: dict | None, arguments: dict) -> ToolResult: ...


class CalculatorRunner:
    async def run(self, config: dict | None, arguments: dict) -> ToolResult:
        expr = arguments.get("expression")
        if not isinstance(expr, str) or not expr.strip():
            return ToolResult.failed("缺少表达式参数 expression")
        try:
            tree = ast.parse(expr.strip(), mode="eval")
            _validate_tree(tree)
            value = eval(  # noqa: S307 - ast 白名单前置校验后执行
                compile(tree, "<tool>", "eval"), {"__builtins__": {}}, SAFE_FUNCS
            )
        except ToolValidationError as exc:
            return ToolResult.failed(str(exc))
        except (ZeroDivisionError, OverflowError, ValueError) as exc:
            return ToolResult.failed(f"计算失败：{exc}")
        except (SyntaxError, RecursionError) as exc:
            return ToolResult.failed(f"表达式不合法：{exc}")
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            return ToolResult.failed("表达式结果必须是数值")
        return ToolResult(output=_format_number(value))


class ToolValidationError(Exception):
    """calculator 表达式白名单校验失败"""


def _format_number(value: int | float) -> str:
    """整数值去掉小数点（避免输出 2.0），浮点保持原样"""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value)


def _validate_tree(node: ast.AST) -> None:
    """递归白名单校验：Expression/BinOp/UnaryOp/Constant/Call 与白名单运算符/函数（tool-calling.md 2.4）"""
    if isinstance(node, ast.Expression):
        _validate_tree(node.body)
    elif isinstance(node, ast.BinOp):
        if type(node.op) not in SAFE_BINOPS:
            raise ToolValidationError("不允许的运算符")
        _validate_tree(node.left)
        _validate_tree(node.right)
    elif isinstance(node, ast.UnaryOp):
        if type(node.op) not in SAFE_UNARYOPS:
            raise ToolValidationError("不允许的运算符")
        _validate_tree(node.operand)
    elif isinstance(node, ast.Constant):
        if not isinstance(node.value, (int, float)) or isinstance(node.value, bool):
            raise ToolValidationError("只允许数值常量")
    elif isinstance(node, ast.Call):
        if not isinstance(node.func, ast.Name) or node.func.id not in SAFE_FUNCS:
            raise ToolValidationError("不允许的函数调用")
        for arg in node.args:
            _validate_tree(arg)
        for kw in node.keywords:
            _validate_tree(kw.value)
    else:
        raise ToolValidationError("不允许的表达式结构")


class HttpRunner:
    async def run(self, config: dict | None, arguments: dict) -> ToolResult:
        if not isinstance(config, dict) or not isinstance(config.get("url"), str):
            return ToolResult.failed("HTTP 工具缺少 url 配置")
        try:
            url = _render_template(config["url"], arguments)
        except ToolRenderError as exc:
            return ToolResult.failed(f"url 模板渲染失败：{exc}")

        method = str(config.get("method", "GET")).upper()
        if method not in HTTP_METHODS:
            return ToolResult.failed(f"不支持的请求方法 {method}")
        try:
            _assert_public_destination(url)
        except SsrfBlocked as exc:
            return ToolResult.failed(f"目标地址不允许访问：{exc}")

        headers = config.get("headers") or {}
        if not isinstance(headers, dict):
            return ToolResult.failed("headers 配置必须为对象")
        body = config.get("body")
        if body is not None and not isinstance(body, (str, bytes)):
            body = json.dumps(body, ensure_ascii=False)

        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(connect=5.0, read=15.0, write=15.0, pool=5.0),
                follow_redirects=False,
            ) as client:
                resp = await client.request(
                    method, url, headers=headers, content=body
                )
        except (httpx.HTTPError, OSError, ValueError) as exc:
            return ToolResult.failed(f"请求失败：{exc}")
        text = resp.text[:MAX_OUTPUT_CHARS]
        if resp.status_code >= 400 or resp.status_code in (300, 301, 302, 303, 307, 308):
            return ToolResult.failed(f"HTTP {resp.status_code}：{text}")
        return ToolResult(output=text or "(空响应)")


class SsrfBlocked(Exception):
    """SSRF 拦截：目标地址不允许访问"""


class ToolRenderError(Exception):
    """url 模板渲染失败（占位符缺失 / 花括号非法）"""


def _render_template(template: str, arguments: dict) -> str:
    """{key} 占位符以 arguments 注入（tool-calling.md D06 桥接）"""
    try:
        return template.format(
            **{k: v for k, v in arguments.items() if isinstance(v, (str, int, float))}
        )
    except (KeyError, ValueError, IndexError) as exc:
        raise ToolRenderError(str(exc)) from exc


def _assert_public_destination(url: str) -> None:
    """SSRF 基础防护（tool-calling.md 2.4 + 风险节）：scheme 白名单 → host 逐跳解析判私网/保留段。
    残余风险（DNS rebinding 等）V1 注明，后续可升级代理或域名白名单。"""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise SsrfBlocked(f"未知协议 {parsed.scheme or '(空)'}")
    host = parsed.hostname
    if not host:
        raise SsrfBlocked("缺少主机名")
    try:
        infos = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80))
    except OSError as exc:
        raise SsrfBlocked(f"域名解析失败 {exc}")
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
        ):
            raise SsrfBlocked(f"禁止访问内网/保留地址 {ip}")


# 执行器注册表：type → runner（新增类型仅需注册，tool-calling.md 2.4）
TOOL_RUNNERS: dict[str, ToolRunner] = {
    "calculator": CalculatorRunner(),
    "http": HttpRunner(),
}


def get_runner(tool_type: str) -> ToolRunner | None:
    return TOOL_RUNNERS.get(tool_type)


def to_openai_tool(tool: Tool) -> dict[str, Any]:
    """转 OpenAI function 格式（tool-calling.md 2.5 tool_choice=auto）"""
    return {
        "type": "function",
        "function": {
            "name": tool.name,
            "description": tool.description or "",
            "parameters": tool.schema or {"type": "object", "properties": {}},
        },
    }


async def run_tool(tool_type: str, config: dict | None, arguments: dict) -> ToolResult:
    """统一执行入口：查执行器 → 执行 → 捕获一切异常转为 error 结果（D11）。
    入参为纯数据（type/config），供 Chat 编排跨 commit 复用（避免 ORM 对象过期）"""
    runner = get_runner(tool_type)
    if runner is None:
        return ToolResult.failed(f"不支持的工具类型 {tool_type}")
    try:
        return await runner.run(config, arguments or {})
    except Exception as exc:  # noqa: BLE001 - 统一降级，不向外抛
        return ToolResult.failed(str(exc))