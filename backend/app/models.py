from datetime import datetime

from sqlalchemy import Column, Integer, String, Float, DateTime, Date, ForeignKey
from sqlalchemy.orm import relationship

from .database import Base


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    username = Column(String, unique=True, nullable=False, index=True)
    display_name = Column(String, nullable=False)
    password_hash = Column(String, nullable=False)
    cash = Column(Float, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    holdings = relationship("Holding", back_populates="user", cascade="all, delete-orphan")
    trades = relationship("Trade", back_populates="user", cascade="all, delete-orphan")
    derivatives = relationship("DerivativePosition", back_populates="user", cascade="all, delete-orphan")


class Holding(Base):
    __tablename__ = "holdings"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    symbol = Column(String, nullable=False, index=True)
    shares = Column(Float, nullable=False)
    avg_cost = Column(Float, nullable=False)

    user = relationship("User", back_populates="holdings")


class Trade(Base):
    __tablename__ = "trades"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    symbol = Column(String, nullable=False)
    side = Column(String, nullable=False)  # BUY or SELL
    shares = Column(Float, nullable=False)
    price = Column(Float, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="trades")


class Snapshot(Base):
    __tablename__ = "snapshots"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    date = Column(Date, nullable=False)
    value = Column(Float, nullable=False)


class DerivativePosition(Base):
    __tablename__ = "derivatives"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    kind = Column(String, nullable=False)        # FUTURE or OPTION
    direction = Column(String, nullable=False)   # LONG/SHORT (future) or CALL/PUT (option)
    symbol = Column(String, nullable=False, index=True)
    leverage = Column(Float, nullable=False)
    entry_price = Column(Float, nullable=False)
    margin = Column(Float, nullable=False)        # cash posted (future) / premium paid (option)
    status = Column(String, nullable=False, default="OPEN")  # OPEN / CLOSED / LIQUIDATED
    opened_at = Column(DateTime, default=datetime.utcnow)
    close_price = Column(Float, nullable=True)
    closed_at = Column(DateTime, nullable=True)
    realized_pnl = Column(Float, nullable=True)

    user = relationship("User", back_populates="derivatives")
