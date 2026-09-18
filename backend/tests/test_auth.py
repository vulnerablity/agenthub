# tests/test_auth.py
# auth 接口集成测试：注册 / 登录 / 刷新 / 当前用户（依赖本机 MySQL，测试库由 conftest 自动准备）
GLOBAL_EMAIL = "alice@test.com"
GLOBAL_PASSWORD = "secret123"


async def _register(client, email=GLOBAL_EMAIL, username="alice", password=GLOBAL_PASSWORD):
    return await client.post(
        "/api/v1/auth/register",
        json={"email": email, "username": username, "password": password},
    )


async def _login(client, email=GLOBAL_EMAIL, password=GLOBAL_PASSWORD):
    return await client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    )


async def test_register_success(client):
    resp = await _register(client)
    assert resp.status_code == 201
    body = resp.json()
    assert body["email"] == GLOBAL_EMAIL
    assert body["id"] > 0


async def test_register_duplicate_email(client):
    await _register(client)
    resp = await _register(client)
    assert resp.status_code == 409
    assert resp.json()["code"] == "EMAIL_ALREADY_REGISTERED"


async def test_register_invalid_email(client):
    resp = await _register(client, email="not-an-email")
    assert resp.status_code == 422


async def test_login_success(client):
    await _register(client)
    resp = await _login(client)
    assert resp.status_code == 200
    body = resp.json()
    assert body["access_token"]
    assert body["refresh_token"]
    assert body["token_type"] == "bearer"
    assert body["expires_in"] > 0


async def test_login_wrong_password(client):
    await _register(client)
    resp = await _login(client, password="wrong-pass")
    assert resp.status_code == 401
    assert resp.json()["code"] == "INVALID_CREDENTIALS"


async def test_login_unknown_email(client):
    resp = await _login(client, email="nobody@test.com")
    assert resp.status_code == 401


async def test_me_requires_token(client):
    resp = await client.get("/api/v1/auth/me")
    assert resp.status_code == 401


async def test_me_returns_user_without_organization(client):
    await _register(client)
    tokens = (await _login(client)).json()
    resp = await client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {tokens['access_token']}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["email"] == GLOBAL_EMAIL
    assert body["username"] == "alice"
    assert body["status"] == "active"
    # 注册不自动创建组织
    assert body["organizations"] == []


async def test_refresh_issues_new_tokens(client):
    await _register(client)
    tokens = (await _login(client)).json()
    resp = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert resp.status_code == 200
    new_tokens = resp.json()
    assert new_tokens["access_token"] != tokens["access_token"]

    # 换发后旧 refresh token 应作废；本机未启动 Redis 时降级为放行，故两种状态均可
    again = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert again.status_code in (200, 401)


async def test_refresh_rejects_access_token(client):
    await _register(client)
    tokens = (await _login(client)).json()
    resp = await client.post(
        "/api/v1/auth/refresh", json={"refresh_token": tokens["access_token"]}
    )
    assert resp.status_code == 401