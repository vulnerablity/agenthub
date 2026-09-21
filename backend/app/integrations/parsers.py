# integrations/parsers.py
# 文档文本抽取与字符切块（同步纯计算）：PDF / TXT / Markdown → 按页抽取 → 跨页窗口切块
# 职责边界：不触网不落库；PDF 仅基础文本抽取，不保证复杂排版/表格/图片结构化（knowledge.md D8）
from dataclasses import dataclass
from io import BytesIO

from pypdf import PdfReader

# 支持的文件类型（匹配 documents.file_type 取值，knowledge.md D6）
SUPPORTED_TYPES = ("pdf", "txt", "md")


@dataclass
class ParsedPage:
    """单页抽取结果；TXT / MD 无页码概念 page_number 为 None"""

    page_number: int | None
    text: str


@dataclass
class ChunkDraft:
    """切块草稿：content 为窗口文本；page_start/page_end 为窗口首尾字符所在页（knowledge.md D8）"""

    content: str
    page_start: int | None
    page_end: int | None


def _decode(data: bytes) -> str:
    """优先 UTF-8，失败回落 GBK（中文环境常见编码），最终兜底替换解码"""
    for encoding in ("utf-8", "gbk"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def extract_pages(file_type: str, data: bytes) -> list[ParsedPage]:
    """按类型抽取文本页；解析失败抛 ValueError（Worker 标记文档 failed 并记录原因，D6）"""
    if file_type == "pdf":
        try:
            reader = PdfReader(BytesIO(data))
        except Exception as exc:
            raise ValueError(f"PDF 解析失败：{exc}") from exc
        pages = [
            ParsedPage(page_number=i, text=text)
            for i, page in enumerate(reader.pages, start=1)
            if (text := (page.extract_text() or "").strip())
        ]
        if not pages:
            raise ValueError("PDF 未提取到可读文本（可能为扫描件或图片型文档）")
        return pages

    text = _decode(data).strip()
    if not text:
        raise ValueError("文件内容为空")
    return [ParsedPage(page_number=None, text=text)]


def estimate_tokens(text: str) -> int:
    """token 数估算：字符长度近似（knowledge.md D7，不引入 tiktoken），至少为 1"""
    return max(1, len(text) // 3 + 1)


def chunk_pages(
    pages: list[ParsedPage], chunk_size: int, chunk_overlap: int
) -> list[ChunkDraft]:
    """跨页连续切块：拼接各页文本，按窗口切分并映射每块首尾字符所在页。

    窗口规则：步长 = chunk_size - chunk_overlap；空块（纯空白）丢弃；
    页码区间 = [窗口首字符所在页, 窗口末字符所在页]，检索响应 page 取 page_start（D8）。
    """
    step = chunk_size - chunk_overlap
    if step <= 0:
        raise ValueError("chunk_size 必须大于 chunk_overlap")
    text = "\n".join(p.text for p in pages)

    # 每页字符区间 [start, end)：页文本 + 其后换行分隔符归本页；末页截断到文本末尾
    ranges: list[tuple[int | None, int, int]] = []
    cursor = 0
    for page in pages:
        end = min(cursor + len(page.text) + 1, len(text))
        ranges.append((page.page_number, cursor, end))
        cursor = end

    def page_at(pos: int) -> int | None:
        for page_no, start, end in ranges:
            if start <= pos < end:
                return page_no
        return ranges[-1][0] if ranges else None

    chunks: list[ChunkDraft] = []
    for start in range(0, max(len(text), 1), step):
        end = min(start + chunk_size, len(text))
        content = text[start:end].strip()
        if not content:
            continue
        chunks.append(
            ChunkDraft(
                content=content,
                page_start=page_at(start),
                page_end=page_at(max(end - 1, start)),
            )
        )
    return chunks
