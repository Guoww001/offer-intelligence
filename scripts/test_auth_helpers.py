import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import auth


def assert_true(value, message):
    if not value:
        raise AssertionError(message)


def main():
    old_env = {key: os.environ.get(key) for key in (
        "OI_AUTH_ENABLED",
        "OI_ADMIN_USERNAME",
        "OI_ADMIN_PASSWORD",
        "OI_ADMIN_PASSWORD_HASH",
        "OI_SESSION_SECRET",
        "OI_SESSION_TTL_SECONDS",
        "PAYMENT_SYNC_TOKEN",
        "OI_PAYMENT_SYNC_TOKEN",
    )}
    try:
        os.environ["OI_AUTH_ENABLED"] = "1"
        os.environ["OI_ADMIN_USERNAME"] = "admin"
        os.environ["OI_ADMIN_PASSWORD_HASH"] = auth.make_password_hash("correct horse battery")
        os.environ["OI_SESSION_SECRET"] = "unit-test-session-secret"
        os.environ["OI_SESSION_TTL_SECONDS"] = "3600"
        os.environ["PAYMENT_SYNC_TOKEN"] = "source-sync-token"
        os.environ.pop("OI_PAYMENT_SYNC_TOKEN", None)
        os.environ.pop("OI_ADMIN_PASSWORD", None)

        status = auth.auth_config_status()
        assert_true(status["configured"], "auth config should be complete")
        assert_true(auth.verify_password("correct horse battery"), "password hash should verify")
        assert_true(not auth.verify_password("wrong password"), "wrong password should not verify")

        token, _expires = auth.create_session("admin")
        headers = {"Cookie": f"{auth.SESSION_COOKIE}={token}"}
        payload = auth.session_payload(headers)
        assert_true(payload and payload["role"] == "admin", "session cookie should authenticate")

        tampered = token[:-2] + "xx"
        bad_headers = {"Cookie": f"{auth.SESSION_COOKIE}={tampered}"}
        assert_true(auth.session_payload(bad_headers) is None, "tampered session should be rejected")

        assert_true(
            auth.is_payment_sync_authenticated({"Authorization": "Bearer source-sync-token"}),
            "bearer sync token should authenticate",
        )
        assert_true(
            auth.is_payment_sync_authenticated({auth.PAYMENT_SYNC_TOKEN_HEADER: "source-sync-token"}),
            "header sync token should authenticate",
        )
        assert_true(
            not auth.is_payment_sync_authenticated({"Authorization": "Bearer wrong-token"}),
            "wrong bearer sync token should be rejected",
        )

        class FakeTarget:
            headers = {"Authorization": "Bearer source-sync-token"}

        assert_true(
            auth.require_auth(FakeTarget(), allow_payment_sync_token=True),
            "require_auth should allow a valid payment sync token when requested",
        )

        print("auth helper checks passed")
    finally:
        for key, value in old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


if __name__ == "__main__":
    main()
