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
