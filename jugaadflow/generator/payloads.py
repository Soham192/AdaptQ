import random
import string


def _rand_id(prefix: str, length: int = 8) -> str:
    return f"{prefix}-{''.join(random.choices(string.ascii_lowercase + string.digits, k=length))}"


def payment_payload() -> dict:
    return {
        "transaction_id": _rand_id("txn"),
        "amount": round(random.uniform(9.99, 4999.99), 2),
        "currency": random.choice(["USD", "EUR", "INR", "GBP"]),
        "customer_id": _rand_id("cust"),
        "method": random.choice(["credit_card", "debit_card", "upi", "wallet", "net_banking"]),
    }


def order_payload() -> dict:
    num_items = random.randint(1, 5)
    items = [{"sku": _rand_id("sku"), "qty": random.randint(1, 3)} for _ in range(num_items)]
    return {
        "order_id": _rand_id("ord"),
        "items": items,
        "total": round(random.uniform(19.99, 9999.99), 2),
        "customer_id": _rand_id("cust"),
    }


def inventory_payload() -> dict:
    return {
        "sku": _rand_id("sku"),
        "warehouse": random.choice(["wh-north", "wh-south", "wh-east", "wh-west", "wh-central"]),
        "quantity_change": random.randint(-50, 200),
        "reason": random.choice(["restock", "sale", "return", "adjustment", "damage"]),
    }


def click_payload() -> dict:
    return {
        "page": random.choice(["/home", "/product/123", "/cart", "/checkout", "/search", "/profile"]),
        "element": random.choice(["buy_btn", "add_cart", "nav_link", "search_bar", "banner", "filter"]),
        "session_id": _rand_id("sess"),
        "user_agent": random.choice(["Chrome/120", "Firefox/119", "Safari/17", "Edge/120", "Mobile/iOS"]),
    }


def log_payload() -> dict:
    return {
        "level": random.choice(["DEBUG", "INFO", "INFO", "INFO", "WARN", "ERROR"]),
        "service": random.choice(["api-gateway", "auth-service", "product-service", "cart-service", "payment-service"]),
        "message": random.choice([
            "Request processed successfully",
            "Cache miss for key",
            "Connection pool exhausted, retrying",
            "Health check passed",
            "Slow query detected (>200ms)",
            "Rate limit approaching threshold",
            "Session token refreshed",
            "Background job completed",
        ]),
        "trace_id": _rand_id("trace"),
    }
