"""Organization avatar normalization and local storage."""

from __future__ import annotations

import hashlib
from io import BytesIO
from pathlib import Path

from PIL import Image, UnidentifiedImageError

from app.core.config import settings
from app.core.exceptions import AvatarInvalid

MAX_AVATAR_BYTES = 5 * 1024 * 1024
MAX_AVATAR_EDGE = 4096
AVATAR_EDGE = 512


class OrganizationAvatarStore:
    def __init__(self) -> None:
        self.root = Path(settings.UPLOAD_DIR).resolve() / "organization-avatars"

    def normalize_and_store(self, org_id: int, content: bytes) -> str:
        if not content or len(content) > MAX_AVATAR_BYTES:
            raise AvatarInvalid("头像文件必须大于 0 且不超过 5MB")
        try:
            with Image.open(BytesIO(content)) as image:
                if image.format not in {"JPEG", "PNG", "WEBP"}:
                    raise AvatarInvalid("头像仅支持 JPG、PNG 或 WebP")
                if image.width != image.height:
                    raise AvatarInvalid("请上传 1:1 正方形头像")
                if image.width > MAX_AVATAR_EDGE or image.height > MAX_AVATAR_EDGE:
                    raise AvatarInvalid("头像尺寸不能超过 4096×4096")
                image = image.convert("RGB")
                image.thumbnail((AVATAR_EDGE, AVATAR_EDGE), Image.Resampling.LANCZOS)
                output = BytesIO()
                image.save(output, format="WEBP", quality=84, method=6)
        except (UnidentifiedImageError, OSError, ValueError) as exc:
            raise AvatarInvalid("无法读取头像图片") from exc

        normalized = output.getvalue()
        if len(normalized) > 1024 * 1024:
            raise AvatarInvalid("头像处理后仍超过 1MB")
        digest = hashlib.sha256(normalized).hexdigest()
        key = f"{org_id}/{digest}.webp"
        path = self.root / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(normalized)
        return key

    @classmethod
    def path_for(cls, key: str | None) -> Path | None:
        if not key:
            return None
        store = cls()
        root = store.root.resolve()
        path = (root / key).resolve()
        if root not in path.parents or path.suffix != ".webp":
            return None
        return path if path.is_file() else None

    def remove(self, key: str | None) -> None:
        path = self.path_for(key)
        if path is not None:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                # DB key is authoritative; stale content can be cleaned by storage maintenance.
                pass
