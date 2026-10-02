# Trusted Network (CTN) Mobile Integration: Connect with ChatGPT

This guide explains how to integrate the **"Connect with ChatGPT"** feature in the Trusted Network iOS and Android mobile applications.

---

## 1. Quick Overview

The mobile application **never** handles OAuth tokens, secrets, or ChatGPT configurations directly.

The flow consists of 3 simple steps:
1. **Fetch Connection URL**: Call `GET /mobile-api/chatgpt/connect` using your existing authenticated CTN session.
2. **Open Browser**: Open the returned `data.url` in the device's system browser (or Custom Tabs / Safari View Controller).
3. **Check Status**: Call `GET /mobile-api/chatgpt/status` to show the connected state.

---

## 2. API Endpoints

All endpoints require the standard mobile authentication header:
```http
Authorization: Bearer <user_access_token>
```

### 1. Initiate Connection
**Endpoint:** `GET /mobile-api/chatgpt/connect`

**Request:**
```http
GET /mobile-api/chatgpt/connect HTTP/1.1
Host: api.trustednetwork.in
Authorization: Bearer <user_token>
```

**Response (Success):**
```json
{
  "success": true,
  "data": {
    "url": "https://mcp.trustednetwork.in/oauth/authorize?client_id=chatgpt-mcp&response_type=code&redirect_uri=https%3A%2F%2Fmcp.trustednetwork.in%2Foauth%2Fcallback&scope=profile%3Aread%20members%3Aread%20posts%3Aread%20posts%3Acreate&state=...&code_challenge=...&code_challenge_method=S256&ticket=..."
  }
}
```

**Mobile Action:**
Open `data.url` in the external system browser:
- **Flutter:** `launchUrl(Uri.parse(data.url), mode: LaunchMode.externalApplication);`
- **React Native:** `Linking.openURL(data.url);`
- **Android (Kotlin):**
  ```kotlin
  val intent = Intent(Intent.ACTION_VIEW, Uri.parse(data.url))
  context.startActivity(intent)
  ```
- **iOS (Swift):**
  ```swift
  if let url = URL(string: data.url) {
      UIApplication.shared.open(url)
  }
  ```

---

### 2. Check Connection Status
**Endpoint:** `GET /mobile-api/chatgpt/status`

Use this endpoint when loading the user's Settings / Integrations screen to display whether ChatGPT is currently connected.

**Request:**
```http
GET /mobile-api/chatgpt/status HTTP/1.1
Host: api.trustednetwork.in
Authorization: Bearer <user_token>
```

**Response (When Connected):**
```json
{
  "success": true,
  "data": {
    "connected": true,
    "scopes": [
      "profile:read",
      "members:read",
      "posts:read",
      "posts:create"
    ],
    "expiresAt": "2026-10-03T18:00:00.000Z"
  }
}
```

**Response (When Disconnected / Never Connected):**
```json
{
  "success": true,
  "data": {
    "connected": false,
    "scopes": []
  }
}
```

---

### 3. Disconnect ChatGPT
**Endpoint:** `POST /mobile-api/chatgpt/disconnect`

Allows the member to revoke ChatGPT's access immediately.

**Request:**
```http
POST /mobile-api/chatgpt/disconnect HTTP/1.1
Host: api.trustednetwork.in
Authorization: Bearer <user_token>
Content-Type: application/json
```

**Response:**
```json
{
  "success": true,
  "message": "ChatGPT connection revoked successfully."
}
```

---

## 3. Deep Link / Return Experience

When the user completes authorization in the browser, the browser will present a success screen:
- It includes an automated button to open the mobile application via deep link:
  `trustednetwork://chatgpt/connected`
- If your mobile app registers the custom scheme `trustednetwork://`, you can handle `trustednetwork://chatgpt/connected` to:
  1. Bring the app to the foreground.
  2. Refresh the connection status (`GET /mobile-api/chatgpt/status`).
  3. Show a toast message: *"ChatGPT connected successfully!"*
- If the deep link is not registered, the user simply sees the web confirmation page and can switch back to the app manually.

---

## 4. UI Recommendations

### "Settings" > "AI & Integrations" Screen:

#### When `connected == false`:
```
+-------------------------------------------------------+
|  [ChatGPT Logo]  ChatGPT Assistant                    |
|  Create posts and browse directory members using AI.  |
|                                                       |
|  Status: Not Connected                                |
|                                                       |
|  [ Connect with ChatGPT ]   <-- Calls /connect & opens|
+-------------------------------------------------------+
```

#### When `connected == true`:
```
+-------------------------------------------------------+
|  [ChatGPT Logo]  ChatGPT Assistant                    |
|  Connected to your Trusted Network account            |
|                                                       |
|  Permissions:                                         |
|  * View profile                                       |
|  * Search members                                     |
|  * Read posts                                         |
|  * Create posts                                       |
|                                                       |
|  [ Disconnect ]             <-- Calls /disconnect     |
+-------------------------------------------------------+
```
