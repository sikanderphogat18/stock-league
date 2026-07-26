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


class OpenDerivativeRequest(BaseModel):
    kind: str           # "future" or "option"
    direction: str      # long/short or call/put
    symbol: str
    leverage: float
    margin: float       # cash to post (future) or premium to pay (option)


class CloseDerivativeRequest(BaseModel):
    position_id: int
