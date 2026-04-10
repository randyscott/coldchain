# Tenant Provisioning

This document describes how to manually provision a new tenant (group) and its
users. These steps are required until Keycloak provisioning is automated.

A tenant consists of two things that must be kept in sync:

1. A **group row** in the coldchain PostgreSQL database
2. A **client scope** in Keycloak that injects the group's ID and each user's
   role into their JWT

---

## Part 1 — Create the group in the database

Connect to the database and insert a new group row. Pick a `slug` that is
URL-safe and unique (lowercase letters, numbers, hyphens only).

```sql
INSERT INTO groups (name, slug)
VALUES ('Acme Refrigeration', 'acme-refrigeration')
RETURNING id;
```

Save the returned UUID — you will need it in Part 2.

---

## Part 2 — Configure Keycloak

Log in to the Keycloak admin console (e.g. `http://localhost:8081/auth/admin`)
and select the **coldchain** realm.

### 2a. Create a client scope for the new tenant

1. Go to **Client scopes → Create client scope**.
2. Set:
   - **Name**: `coldchain-acme` (or any descriptive name)
   - **Type**: Optional
   - **Protocol**: OpenID Connect
3. Save.

### 2b. Add protocol mappers to the scope

Inside the new client scope, go to the **Mappers** tab and create two mappers:

**Mapper 1 — group_id**

| Field | Value |
|---|---|
| Mapper type | Hardcoded claim |
| Name | `group_id` |
| Token claim name | `group_id` |
| Claim value | *(the UUID returned in Part 1)* |
| Claim JSON type | String |
| Add to ID token | On |
| Add to access token | On |
| Add to userinfo | Off |

**Mapper 2 — role**

| Field | Value |
|---|---|
| Mapper type | User attribute |
| Name | `role` |
| User attribute | `coldchain_role` |
| Token claim name | `role` |
| Claim JSON type | String |
| Add to ID token | On |
| Add to access token | On |
| Add to userinfo | Off |

> The `role` mapper reads a user attribute called `coldchain_role`. You will set
> this per-user in step 2d. Valid values are `admin`, `manager`, `viewer`.

### 2c. Assign the scope to the coldchain-web client

1. Go to **Clients → coldchain-web → Client scopes**.
2. Click **Add client scope** and add the scope you just created as **Optional**
   (or **Default** if all users of this client should be in this tenant — only
   appropriate if there is a single tenant).

### 2d. Create users and assign the scope

For each user that should belong to this tenant:

1. Go to **Users → Create new user**.
2. Fill in **Username**, **Email**, and **First/Last name**. Save.
3. On the **Credentials** tab, set a temporary password.
4. On the **Attributes** tab, add:
   - Key: `coldchain_role`   Value: `admin` / `manager` / `viewer`
5. On the **Client scopes** tab of the user's token (visible under **Sessions →
   token details** after the user first logs in), confirm the `group_id` and
   `role` claims are present.

> Alternatively, assign the client scope at the user level via **Users →
> *username* → Client scopes → Assigned optional client scopes**.

---

## Part 3 — First login auto-sync

No further database work is needed for individual users. When a user logs in for
the first time, `POST /api/v1/auth/sync` is called automatically by the
frontend. This upserts a row into the `users` table using the `group_id` and
`email` claims from the JWT.

After first login the user will appear in the **Team** page for any admin or
manager in that group.

---

## Setting the platform admin flag

The `is_platform_admin` flag is never set by Keycloak — it is managed directly
in the database to prevent privilege escalation via a crafted JWT.

To elevate a user to platform admin after their first login:

```sql
UPDATE users
SET is_platform_admin = TRUE
WHERE email = 'admin@acme.example'
  AND group_id = '<group-uuid>';
```

Platform admins can see the group switcher in the navigation bar once more than
one group exists, allowing them to operate in any tenant's context.

---

## Checklist

- [ ] Group row inserted into `groups` table, UUID noted
- [ ] Client scope created in Keycloak with `group_id` (hardcoded) and `role` (user attribute) mappers
- [ ] Scope assigned to `coldchain-web` client
- [ ] Users created in Keycloak with `coldchain_role` attribute set
- [ ] Users log in at least once (triggers auto-sync into `users` table)
- [ ] Platform admin flag set in DB if required
