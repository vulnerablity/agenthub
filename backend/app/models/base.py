# models/base.py
# ORM 声明基类：所有模型共用
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """所有 SQLAlchemy 模型的基类，Alembic 通过其 metadata 生成迁移"""
