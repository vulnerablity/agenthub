# core/exceptions.py
# 业务异常统一定义：由 main.py 的全局异常处理器转为统一 JSON 响应
class AppError(Exception):
    """业务异常基类"""

    def __init__(self, status_code: int, code: str, message: str) -> None:
        self.status_code = status_code
        self.code = code
        self.message = message
        super().__init__(message)


class EmailAlreadyRegistered(AppError):
    def __init__(self) -> None:
        super().__init__(409, "EMAIL_ALREADY_REGISTERED", "该邮箱已被注册")


class InvalidCredentials(AppError):
    def __init__(self) -> None:
        super().__init__(401, "INVALID_CREDENTIALS", "邮箱或密码错误")


class TokenInvalid(AppError):
    def __init__(self) -> None:
        super().__init__(401, "TOKEN_INVALID", "无效的身份凭证")


class TokenExpired(AppError):
    def __init__(self) -> None:
        super().__init__(401, "TOKEN_EXPIRED", "身份凭证已过期")


class UserNotFound(AppError):
    def __init__(self) -> None:
        super().__init__(404, "USER_NOT_FOUND", "用户不存在")


class UserInactive(AppError):
    def __init__(self) -> None:
        super().__init__(403, "USER_INACTIVE", "账号已被禁用")


class Forbidden(AppError):
    def __init__(self) -> None:
        super().__init__(403, "FORBIDDEN", "没有操作权限")


# 组织域错误码（organization 模块）


class OrganizationNotFound(AppError):
    def __init__(self) -> None:
        super().__init__(404, "ORGANIZATION_NOT_FOUND", "组织不存在")


class NotOrgMember(AppError):
    def __init__(self) -> None:
        super().__init__(403, "NOT_ORG_MEMBER", "您不是该组织成员")


class AlreadyMember(AppError):
    def __init__(self) -> None:
        super().__init__(409, "ALREADY_MEMBER", "该用户已在组织中")


class OrgMemberNotFound(AppError):
    def __init__(self) -> None:
        super().__init__(404, "ORG_MEMBER_NOT_FOUND", "该用户不是组织成员")


class OwnerRequired(AppError):
    def __init__(self) -> None:
        super().__init__(403, "OWNER_REQUIRED", "该操作仅组织拥有者可执行")


class OwnerCannotLeave(AppError):
    def __init__(self) -> None:
        super().__init__(
            403, "OWNER_CANNOT_LEAVE", "组织拥有者不能退出组织，请先转让或解散"
        )


class OwnerCannotBeRemoved(AppError):
    def __init__(self) -> None:
        super().__init__(403, "OWNER_CANNOT_BE_REMOVED", "组织拥有者不能被移除")


class OwnerMustTransfer(AppError):
    def __init__(self) -> None:
        super().__init__(403, "OWNER_MUST_TRANSFER", "组织拥有者只能通过转让变更")


class RoleNotAssignable(AppError):
    def __init__(self) -> None:
        super().__init__(403, "ROLE_NOT_ASSIGNABLE", "不能分配该角色")


class MemberManageForbidden(AppError):
    def __init__(self) -> None:
        super().__init__(403, "MEMBER_MANAGE_FORBIDDEN", "没有权限管理该成员")


class SelfRoleChangeForbidden(AppError):
    def __init__(self) -> None:
        super().__init__(403, "SELF_ROLE_CHANGE_FORBIDDEN", "不能修改自己的角色")


# 智能体域错误码（agent 模块）


class AgentNotFound(AppError):
    def __init__(self) -> None:
        super().__init__(404, "AGENT_NOT_FOUND", "智能体不存在")


class AgentNameConflict(AppError):
    def __init__(self) -> None:
        super().__init__(409, "AGENT_NAME_CONFLICT", "智能体名称已存在")


class AgentFieldRequired(AppError):
    def __init__(self, field: str) -> None:
        super().__init__(422, "AGENT_FIELD_REQUIRED", f"{field}不能为空")


class AgentVersionNotFound(AppError):
    def __init__(self) -> None:
        super().__init__(404, "AGENT_VERSION_NOT_FOUND", "智能体版本不存在")


class AgentVersionConflict(AppError):
    def __init__(self) -> None:
        super().__init__(409, "AGENT_VERSION_CONFLICT", "版本创建冲突，请重试")


# 对话域错误码（chat 模块）


class ConversationNotFound(AppError):
    def __init__(self) -> None:
        super().__init__(404, "CONVERSATION_NOT_FOUND", "会话不存在")


class AgentNotAvailable(AppError):
    def __init__(self) -> None:
        super().__init__(409, "AGENT_NOT_AVAILABLE", "智能体未启用或未发布版本")


class ConversationBusy(AppError):
    def __init__(self) -> None:
        super().__init__(409, "CONVERSATION_BUSY", "会话正在生成回答，请稍候")


class MessageContentRequired(AppError):
    def __init__(self) -> None:
        super().__init__(400, "MESSAGE_CONTENT_REQUIRED", "消息内容不能为空")


class MessageContentTooLong(AppError):
    def __init__(self) -> None:
        super().__init__(400, "MESSAGE_CONTENT_TOO_LONG", "消息内容过长")


class LLMUpstreamError(AppError):
    def __init__(self) -> None:
        super().__init__(502, "LLM_UPSTREAM_ERROR", "上游大模型调用失败")


class LLMTimeout(AppError):
    def __init__(self) -> None:
        super().__init__(502, "LLM_TIMEOUT", "上游大模型调用超时")


# 知识库域错误码（knowledge 模块）


class KnowledgeBaseNotFound(AppError):
    def __init__(self) -> None:
        super().__init__(404, "KB_NOT_FOUND", "知识库不存在")


class KnowledgeBaseNameConflict(AppError):
    def __init__(self) -> None:
        super().__init__(409, "KB_NAME_CONFLICT", "知识库名称已存在")


class KnowledgeBaseFieldRequired(AppError):
    def __init__(self, field: str) -> None:
        super().__init__(422, "KB_FIELD_REQUIRED", f"{field}不能为空")


class KnowledgeBaseProcessing(AppError):
    def __init__(self) -> None:
        super().__init__(
            409, "KB_PROCESSING", "该知识库存在正在处理的文档，请等待处理完成后再删除"
        )


class DocumentNotFound(AppError):
    def __init__(self) -> None:
        super().__init__(404, "DOCUMENT_NOT_FOUND", "文档不存在")


class DocumentProcessing(AppError):
    def __init__(self) -> None:
        super().__init__(409, "DOCUMENT_PROCESSING", "文档正在处理中，无法删除")


class FileTypeNotSupported(AppError):
    def __init__(self) -> None:
        super().__init__(
            400, "FILE_TYPE_NOT_SUPPORTED", "仅支持 PDF、TXT、Markdown 文件"
        )


class FileTooLarge(AppError):
    def __init__(self) -> None:
        super().__init__(413, "FILE_TOO_LARGE", "文件大小超出限制")


class FileEmpty(AppError):
    def __init__(self) -> None:
        super().__init__(400, "FILE_EMPTY", "文件内容为空")


class EmbeddingUpstreamError(AppError):
    def __init__(self) -> None:
        super().__init__(502, "EMBEDDING_UPSTREAM_ERROR", "Embedding 上游调用失败")


class VectorStoreError(AppError):
    def __init__(self) -> None:
        super().__init__(502, "VECTOR_STORE_ERROR", "向量库操作失败")


class RAGConfigInvalid(AppError):
    def __init__(self) -> None:
        super().__init__(422, "RAG_CONFIG_INVALID", "知识库绑定配置不合法")
