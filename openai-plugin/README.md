# Trusted Network — OpenAI Plugin Package

This directory contains the manifest and package resources required for submitting the **Trusted Network** MCP application to the OpenAI Plugin & Connector Directory.

---

## 1. Directory Contents

```text
openai-plugin/
├── plugin.json              # OpenAI Plugin Manifest v1
├── .mcp.json                # MCP Server endpoint configuration
├── assets/                  # High-resolution logos and icons
│   ├── logo.png             # Square logo (512x512)
│   ├── logo-dark.png        # Dark mode variant
│   └── composer-icon.png    # Chat input composer badge (32x32)
└── README.md                # Package documentation and instructions
```

---

## 2. Server Configuration

- **MCP Transport Server:** `https://mcp.trustednetwork.in/mcp`
- **Protected Resource Identifier:** `https://mcp.trustednetwork.in`
- **OAuth Authorization Server:** `https://api.trustednetwork.in`
- **OAuth Authorize Endpoint:** `https://api.trustednetwork.in/oauth/authorize`
- **OAuth Token Endpoint:** `https://api.trustednetwork.in/oauth/token`
- **Supported Scopes:** `profile:read`, `members:read`, `posts:read`, `posts:create`, `posts:update`, `posts:delete`

---

## 3. Official Plugin Metadata

- **Display Name:** Trusted
- **Short Description:** Business networking with Trusted
- **Long Description:** Use Trusted through ChatGPT to manage your professional network, discover verified business members, view your Trusted activity, and create posts on your behalf.
- **Website URL:** `https://trustednetwork.in`
- **Support URL:** `https://trustednetwork.in/support` *(Verify/create before public submission)*
- **Privacy Policy URL:** `https://trustednetwork.in/privacy` *(Verify/create before public submission)*
- **Terms of Service URL:** `https://trustednetwork.in/terms` *(Verify/create before public submission)*

---

## 4. Starter Prompts (Section 60)

1. **"Show my Trusted profile"**
   - Calls `get_my_profile`
   - Returns business information, subscription status, and contact card.

2. **"Find business members near me"**
   - Calls `get_nearby_members`
   - Returns verified directory members within geographical radius.

3. **"Create a post for my Trusted network"**
   - Calls `create_post`
   - Prompts the user with a draft and requests confirmation before publishing.
