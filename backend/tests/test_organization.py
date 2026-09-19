# tests/test_organization.py
# organization 接口集成测试：覆盖创建 / 成员管理 / 权限矩阵 / 转让 / 退出 / 解散
PASSWORD = "secret123"


async def _register(client, email, username):
    return await client.post(
        "/api/v1/auth/register",
        json={"email": email, "username": username, "password": PASSWORD},
    )


async def _token(client, email):
    resp = await client.post(
        "/api/v1/auth/login", json={"email": email, "password": PASSWORD}
    )
    return resp.json()["access_token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


async def _create_org(client, token, name="Acme"):
    return await client.post(
        "/api/v1/organizations", json={"name": name}, headers=_auth(token)
    )


# ---------- 组织 CRUD ----------


async def test_create_org_and_lists(client):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    resp = await _create_org(client, token)
    assert resp.status_code == 201
    org = resp.json()
    assert org["name"] == "Acme"
    assert org["my_role"] == "owner"
    assert org["owner_username"] == "alice"
    assert org["member_count"] == 1

    # 我的组织列表
    lst = await client.get("/api/v1/organizations", headers=_auth(token))
    assert lst.status_code == 200
    assert len(lst.json()) == 1
    assert lst.json()[0]["role"] == "owner"

    # 组织详情
    detail = await client.get(
        f"/api/v1/organizations/{org['id']}", headers=_auth(token)
    )
    assert detail.status_code == 200
    assert detail.json()["my_role"] == "owner"

    # me 的组织数组联动
    me = await client.get("/api/v1/auth/me", headers=_auth(token))
    assert [o["name"] for o in me.json()["organizations"]] == ["Acme"]


async def test_create_org_validation(client):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    resp = await client.post(
        "/api/v1/organizations", json={"name": ""}, headers=_auth(token)
    )
    assert resp.status_code == 422
    resp = await client.post(
        "/api/v1/organizations", json={"name": "x" * 101}, headers=_auth(token)
    )
    assert resp.status_code == 422


async def test_org_requires_auth(client):
    assert (await client.get("/api/v1/organizations")).status_code == 401
    assert (
        await client.post("/api/v1/organizations", json={"name": "x"})
    ).status_code == 401


async def test_org_not_found(client):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    resp = await client.get("/api/v1/organizations/999999", headers=_auth(token))
    assert resp.status_code == 404
    assert resp.json()["code"] == "ORGANIZATION_NOT_FOUND"


async def test_non_member_forbidden(client):
    await _register(client, "alice@test.com", "alice")
    await _register(client, "bob@test.com", "bob")
    alice_token = await _token(client, "alice@test.com")
    bob_token = await _token(client, "bob@test.com")
    org = (await _create_org(client, bob_token)).json()
    resp = await client.get(
        f"/api/v1/organizations/{org['id']}", headers=_auth(alice_token)
    )
    assert resp.status_code == 403
    assert resp.json()["code"] == "NOT_ORG_MEMBER"


async def test_rename(client):
    await _register(client, "alice@test.com", "alice")
    await _register(client, "bob@test.com", "bob")
    alice_token = await _token(client, "alice@test.com")
    bob_token = await _token(client, "bob@test.com")
    org = (await _create_org(client, alice_token)).json()

    resp = await client.patch(
        f"/api/v1/organizations/{org['id']}",
        json={"name": "NewName"},
        headers=_auth(alice_token),
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "NewName"

    # member 无权改名
    await client.post(
        f"/api/v1/organizations/{org['id']}/members",
        json={"email": "bob@test.com", "role": "member"},
        headers=_auth(alice_token),
    )
    resp = await client.patch(
        f"/api/v1/organizations/{org['id']}",
        json={"name": "Hack"},
        headers=_auth(bob_token),
    )
    assert resp.status_code == 403


# ---------- 成员管理 ----------


async def test_add_member_and_list(client):
    await _register(client, "alice@test.com", "alice")
    await _register(client, "bob@test.com", "bob")
    alice_token = await _token(client, "alice@test.com")
    bob_token = await _token(client, "bob@test.com")
    org = (await _create_org(client, alice_token)).json()

    resp = await client.post(
        f"/api/v1/organizations/{org['id']}/members",
        json={"email": "bob@test.com", "role": "member"},
        headers=_auth(alice_token),
    )
    assert resp.status_code == 201
    assert resp.json()["user_id"] > 0
    assert resp.json()["role"] == "member"
    assert resp.json()["email"] == "bob@test.com"

    members = await client.get(
        f"/api/v1/organizations/{org['id']}/members", headers=_auth(alice_token)
    )
    assert len(members.json()) == 2

    # bob 视角：组织列表 role=member
    lst = await client.get("/api/v1/organizations", headers=_auth(bob_token))
    assert lst.json()[0]["role"] == "member"


async def test_add_member_unknown_email(client):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = (await _create_org(client, token)).json()
    resp = await client.post(
        f"/api/v1/organizations/{org['id']}/members",
        json={"email": "nobody@test.com", "role": "member"},
        headers=_auth(token),
    )
    assert resp.status_code == 404
    assert resp.json()["code"] == "USER_NOT_FOUND"


async def test_add_member_duplicate(client):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = (await _create_org(client, token)).json()
    resp = await client.post(
        f"/api/v1/organizations/{org['id']}/members",
        json={"email": "alice@test.com", "role": "member"},
        headers=_auth(token),
    )
    assert resp.status_code == 409
    assert resp.json()["code"] == "ALREADY_MEMBER"


async def test_add_member_invalid_role(client):
    await _register(client, "alice@test.com", "alice")
    await _register(client, "bob@test.com", "bob")
    token = await _token(client, "alice@test.com")
    org = (await _create_org(client, token)).json()
    resp = await client.post(
        f"/api/v1/organizations/{org['id']}/members",
        json={"email": "bob@test.com", "role": "owner"},
        headers=_auth(token),
    )
    assert resp.status_code == 422


async def test_member_cannot_add(client):
    await _register(client, "alice@test.com", "alice")
    await _register(client, "bob@test.com", "bob")
    await _register(client, "carol@test.com", "carol")
    alice_token = await _token(client, "alice@test.com")
    bob_token = await _token(client, "bob@test.com")
    org = (await _create_org(client, alice_token)).json()
    await client.post(
        f"/api/v1/organizations/{org['id']}/members",
        json={"email": "bob@test.com", "role": "member"},
        headers=_auth(alice_token),
    )
    resp = await client.post(
        f"/api/v1/organizations/{org['id']}/members",
        json={"email": "carol@test.com", "role": "member"},
        headers=_auth(bob_token),
    )
    assert resp.status_code == 403


async def test_admin_cannot_grant_admin(client):
    await _register(client, "alice@test.com", "alice")
    await _register(client, "carol@test.com", "carol")
    await _register(client, "dave@test.com", "dave")
    alice_token = await _token(client, "alice@test.com")
    carol_token = await _token(client, "carol@test.com")
    org = (await _create_org(client, alice_token)).json()
    await client.post(
        f"/api/v1/organizations/{org['id']}/members",
        json={"email": "carol@test.com", "role": "admin"},
        headers=_auth(alice_token),
    )
    # admin 不能授予 admin
    resp = await client.post(
        f"/api/v1/organizations/{org['id']}/members",
        json={"email": "dave@test.com", "role": "admin"},
        headers=_auth(carol_token),
    )
    assert resp.status_code == 403
    assert resp.json()["code"] == "ROLE_NOT_ASSIGNABLE"
    # admin 可添加普通成员
    resp = await client.post(
        f"/api/v1/organizations/{org['id']}/members",
        json={"email": "dave@test.com", "role": "member"},
        headers=_auth(carol_token),
    )
    assert resp.status_code == 201


async def test_members_email_filter(client):
    await _register(client, "alice@test.com", "alice")
    await _register(client, "bob@test.com", "bob")
    await _register(client, "carol@test.com", "carol")
    token = await _token(client, "alice@test.com")
    org = (await _create_org(client, token)).json()
    for email in ("bob@test.com", "carol@test.com"):
        await client.post(
            f"/api/v1/organizations/{org['id']}/members",
            json={"email": email, "role": "member"},
            headers=_auth(token),
        )
    resp = await client.get(
        f"/api/v1/organizations/{org['id']}/members?email=bo", headers=_auth(token)
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["email"] == "bob@test.com"


# ---------- 角色修改 / 转让 ----------


async def test_update_member_role(client):
    await _register(client, "alice@test.com", "alice")
    await _register(client, "bob@test.com", "bob")
    alice_token = await _token(client, "alice@test.com")
    bob_token = await _token(client, "bob@test.com")
    org = (await _create_org(client, alice_token)).json()
    added = (
        await client.post(
            f"/api/v1/organizations/{org['id']}/members",
            json={"email": "bob@test.com", "role": "member"},
            headers=_auth(alice_token),
        )
    ).json()

    resp = await client.patch(
        f"/api/v1/organizations/{org['id']}/members/{added['user_id']}",
        json={"role": "admin"},
        headers=_auth(alice_token),
    )
    assert resp.status_code == 200
    assert resp.json()["role"] == "admin"

    # member 无权修改
    resp = await client.patch(
        f"/api/v1/organizations/{org['id']}/members/{added['user_id']}",
        json={"role": "viewer"},
        headers=_auth(bob_token),
    )
    assert resp.status_code == 403


async def test_admin_role_modify_limits(client):
    await _register(client, "alice@test.com", "alice")
    await _register(client, "bob@test.com", "bob")
    await _register(client, "carol@test.com", "carol")
    await _register(client, "dave@test.com", "dave")
    alice_token = await _token(client, "alice@test.com")
    carol_token = await _token(client, "carol@test.com")
    org = (await _create_org(client, alice_token)).json()
    # 成员：bob=admin, carol=admin, dave=member
    for email in ("bob@test.com", "carol@test.com"):
        await client.post(
            f"/api/v1/organizations/{org['id']}/members",
            json={"email": email, "role": "admin"},
            headers=_auth(alice_token),
        )
    dave = (
        await client.post(
            f"/api/v1/organizations/{org['id']}/members",
            json={"email": "dave@test.com", "role": "member"},
            headers=_auth(alice_token),
        )
    ).json()
    members = (
        await client.get(
            f"/api/v1/organizations/{org['id']}/members", headers=_auth(alice_token)
        )
    ).json()
    bob_id = next(m["user_id"] for m in members if m["email"] == "bob@test.com")

    # admin 不能改 admin
    resp = await client.patch(
        f"/api/v1/organizations/{org['id']}/members/{bob_id}",
        json={"role": "viewer"},
        headers=_auth(carol_token),
    )
    assert resp.status_code == 403
    assert resp.json()["code"] == "MEMBER_MANAGE_FORBIDDEN"

    # admin 不能把成员提升为 admin
    resp = await client.patch(
        f"/api/v1/organizations/{org['id']}/members/{dave['user_id']}",
        json={"role": "admin"},
        headers=_auth(carol_token),
    )
    assert resp.status_code == 403
    assert resp.json()["code"] == "ROLE_NOT_ASSIGNABLE"

    # admin 可调整普通成员为 viewer
    resp = await client.patch(
        f"/api/v1/organizations/{org['id']}/members/{dave['user_id']}",
        json={"role": "viewer"},
        headers=_auth(carol_token),
    )
    assert resp.status_code == 200
    assert resp.json()["role"] == "viewer"


async def test_self_role_change_forbidden(client):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = (await _create_org(client, token)).json()
    me = (await client.get("/api/v1/auth/me", headers=_auth(token))).json()
    resp = await client.patch(
        f"/api/v1/organizations/{org['id']}/members/{me['id']}",
        json={"role": "viewer"},
        headers=_auth(token),
    )
    assert resp.status_code == 403
    assert resp.json()["code"] == "SELF_ROLE_CHANGE_FORBIDDEN"


async def test_transfer_ownership(client):
    await _register(client, "alice@test.com", "alice")
    await _register(client, "bob@test.com", "bob")
    alice_token = await _token(client, "alice@test.com")
    bob_token = await _token(client, "bob@test.com")
    org = (await _create_org(client, alice_token)).json()
    bob = (
        await client.post(
            f"/api/v1/organizations/{org['id']}/members",
            json={"email": "bob@test.com", "role": "member"},
            headers=_auth(alice_token),
        )
    ).json()

    resp = await client.patch(
        f"/api/v1/organizations/{org['id']}/members/{bob['user_id']}",
        json={"role": "owner"},
        headers=_auth(alice_token),
    )
    assert resp.status_code == 200
    assert resp.json()["role"] == "owner"

    # owner_id 同步：详情 owner 已变，旧 owner 降为 admin
    detail = (
        await client.get(f"/api/v1/organizations/{org['id']}", headers=_auth(bob_token))
    ).json()
    assert detail["my_role"] == "owner"
    assert detail["owner_username"] == "bob"
    alice_detail = (
        await client.get(
            f"/api/v1/organizations/{org['id']}", headers=_auth(alice_token)
        )
    ).json()
    assert alice_detail["my_role"] == "admin"

    # 新 owner 获得全部权限（改名成功）
    resp = await client.patch(
        f"/api/v1/organizations/{org['id']}",
        json={"name": "BobOrg"},
        headers=_auth(bob_token),
    )
    assert resp.status_code == 200


async def test_transfer_rejections(client):
    await _register(client, "alice@test.com", "alice")
    await _register(client, "bob@test.com", "bob")
    await _register(client, "carol@test.com", "carol")
    alice_token = await _token(client, "alice@test.com")
    bob_token = await _token(client, "bob@test.com")
    carol_token = await _token(client, "carol@test.com")
    org = (await _create_org(client, alice_token)).json()
    await client.post(
        f"/api/v1/organizations/{org['id']}/members",
        json={"email": "bob@test.com", "role": "member"},
        headers=_auth(alice_token),
    )
    await client.post(
        f"/api/v1/organizations/{org['id']}/members",
        json={"email": "carol@test.com", "role": "admin"},
        headers=_auth(alice_token),
    )
    members = (
        await client.get(
            f"/api/v1/organizations/{org['id']}/members", headers=_auth(alice_token)
        )
    ).json()
    bob_id = next(m["user_id"] for m in members if m["email"] == "bob@test.com")
    alice_id = next(m["user_id"] for m in members if m["email"] == "alice@test.com")

    # member 尝试转让 → 依赖层拦截
    resp = await client.patch(
        f"/api/v1/organizations/{org['id']}/members/{bob_id}",
        json={"role": "owner"},
        headers=_auth(bob_token),
    )
    assert resp.status_code == 403
    assert resp.json()["code"] == "FORBIDDEN"

    # admin 尝试转让 → OWNER_REQUIRED
    resp = await client.patch(
        f"/api/v1/organizations/{org['id']}/members/{bob_id}",
        json={"role": "owner"},
        headers=_auth(carol_token),
    )
    assert resp.status_code == 403
    assert resp.json()["code"] == "OWNER_REQUIRED"

    # 转让给非成员
    resp = await client.patch(
        f"/api/v1/organizations/{org['id']}/members/999999",
        json={"role": "owner"},
        headers=_auth(alice_token),
    )
    assert resp.status_code == 404
    assert resp.json()["code"] == "ORG_MEMBER_NOT_FOUND"

    # 转让给自己
    resp = await client.patch(
        f"/api/v1/organizations/{org['id']}/members/{alice_id}",
        json={"role": "owner"},
        headers=_auth(alice_token),
    )
    assert resp.status_code == 403
    assert resp.json()["code"] == "SELF_ROLE_CHANGE_FORBIDDEN"


# ---------- 移除 / 退出 / 解散 ----------


async def test_remove_member(client):
    await _register(client, "alice@test.com", "alice")
    await _register(client, "bob@test.com", "bob")
    token = await _token(client, "alice@test.com")
    org = (await _create_org(client, token)).json()
    bob = (
        await client.post(
            f"/api/v1/organizations/{org['id']}/members",
            json={"email": "bob@test.com", "role": "member"},
            headers=_auth(token),
        )
    ).json()

    resp = await client.delete(
        f"/api/v1/organizations/{org['id']}/members/{bob['user_id']}",
        headers=_auth(token),
    )
    assert resp.status_code == 204
    members = (
        await client.get(
            f"/api/v1/organizations/{org['id']}/members", headers=_auth(token)
        )
    ).json()
    assert len(members) == 1

    resp = await client.delete(
        f"/api/v1/organizations/{org['id']}/members/{bob['user_id']}",
        headers=_auth(token),
    )
    assert resp.status_code == 404
    assert resp.json()["code"] == "ORG_MEMBER_NOT_FOUND"


async def test_owner_cannot_be_removed_and_admin_limits(client):
    await _register(client, "alice@test.com", "alice")
    await _register(client, "bob@test.com", "bob")
    await _register(client, "carol@test.com", "carol")
    alice_token = await _token(client, "alice@test.com")
    carol_token = await _token(client, "carol@test.com")
    org = (await _create_org(client, alice_token)).json()
    for email in ("bob@test.com", "carol@test.com"):
        await client.post(
            f"/api/v1/organizations/{org['id']}/members",
            json={"email": email, "role": "admin"},
            headers=_auth(alice_token),
        )
    members = (
        await client.get(
            f"/api/v1/organizations/{org['id']}/members", headers=_auth(alice_token)
        )
    ).json()
    alice_id = next(m["user_id"] for m in members if m["email"] == "alice@test.com")
    bob_id = next(m["user_id"] for m in members if m["email"] == "bob@test.com")

    # admin 不能移除 owner
    resp = await client.delete(
        f"/api/v1/organizations/{org['id']}/members/{alice_id}",
        headers=_auth(carol_token),
    )
    assert resp.status_code == 403
    assert resp.json()["code"] == "OWNER_CANNOT_BE_REMOVED"

    # admin 不能移除 admin
    resp = await client.delete(
        f"/api/v1/organizations/{org['id']}/members/{bob_id}",
        headers=_auth(carol_token),
    )
    assert resp.status_code == 403
    assert resp.json()["code"] == "MEMBER_MANAGE_FORBIDDEN"


async def test_leave_org(client):
    await _register(client, "alice@test.com", "alice")
    await _register(client, "bob@test.com", "bob")
    alice_token = await _token(client, "alice@test.com")
    bob_token = await _token(client, "bob@test.com")
    org = (await _create_org(client, alice_token)).json()
    await client.post(
        f"/api/v1/organizations/{org['id']}/members",
        json={"email": "bob@test.com", "role": "member"},
        headers=_auth(alice_token),
    )

    resp = await client.delete(
        f"/api/v1/organizations/{org['id']}/members/me", headers=_auth(bob_token)
    )
    assert resp.status_code == 204

    # 退出后不再是成员
    resp = await client.get(
        f"/api/v1/organizations/{org['id']}", headers=_auth(bob_token)
    )
    assert resp.status_code == 403
    assert resp.json()["code"] == "NOT_ORG_MEMBER"


async def test_owner_cannot_leave(client):
    await _register(client, "alice@test.com", "alice")
    token = await _token(client, "alice@test.com")
    org = (await _create_org(client, token)).json()
    resp = await client.delete(
        f"/api/v1/organizations/{org['id']}/members/me", headers=_auth(token)
    )
    assert resp.status_code == 403
    assert resp.json()["code"] == "OWNER_CANNOT_LEAVE"


async def test_dissolve(client):
    await _register(client, "alice@test.com", "alice")
    await _register(client, "bob@test.com", "bob")
    alice_token = await _token(client, "alice@test.com")
    bob_token = await _token(client, "bob@test.com")
    org = (await _create_org(client, alice_token)).json()
    await client.post(
        f"/api/v1/organizations/{org['id']}/members",
        json={"email": "bob@test.com", "role": "member"},
        headers=_auth(alice_token),
    )

    # member 无权解散
    resp = await client.delete(
        f"/api/v1/organizations/{org['id']}", headers=_auth(bob_token)
    )
    assert resp.status_code == 403

    # owner 解散
    resp = await client.delete(
        f"/api/v1/organizations/{org['id']}", headers=_auth(alice_token)
    )
    assert resp.status_code == 204
    assert (
        await client.get(
            f"/api/v1/organizations/{org['id']}", headers=_auth(alice_token)
        )
    ).status_code == 404

    # 双方组织列表均空
    for token in (alice_token, bob_token):
        lst = await client.get("/api/v1/organizations", headers=_auth(token))
        assert lst.json() == []
