from typing import Optional
from pydantic import BaseModel


class RegisterRequest(BaseModel):
    username: str
    display_name: str
    password: str
    invite_code: Optional[str] = None


class LoginRequest(BaseModel):
    username: str
    password: str


class TradeRequest(BaseModel):
    symbol: str
    shares: float
