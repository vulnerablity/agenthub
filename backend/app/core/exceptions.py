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
