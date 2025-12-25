# from passlib.context import CryptContext

# pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# def hash_password(password: str) -> str:
#     return pwd_context.hash(password)

# def verify_password(password: str, password_hash: str) -> bool:
#     return pwd_context.verify(password, password_hash)

import hashlib
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def _prehash_password(password: str) -> str:
    # SHA-256 -> 64-char hex string, always fixed length
    return hashlib.sha256(password.encode("utf-8")).hexdigest()

def hash_password(password: str) -> str:
    return pwd_context.hash(_prehash_password(password))

def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(_prehash_password(password), password_hash)
