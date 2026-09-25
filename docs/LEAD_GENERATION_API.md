# AI Lead Generation API Documentation

Complete reference document for the AI-powered Lead Generation module in the CTN Backend platform.

---

## 📌 Overview & Base Configuration

* **Base URL**: `http://<host>:<port>` (e.g. `http://localhost:5001`)
* **Route Prefix**: `/mobile-api/lead-generation`
* **Authentication**: All endpoints require a valid Member JWT token in the `Authorization` header.

### Request Headers
```http
Authorization: Bearer <JWT_MEMBER_TOKEN>
Content-Type: application/json
```

---

## 📋 Endpoint Summary Table

| Method | Endpoint | Description |
|:---|:---|:---|
| `POST` | `/mobile-api/lead-generation` | **Create Search**: Generates prompt, saves as `PENDING`, queues background AI job. |
| `GET` | `/mobile-api/lead-generation` | **List Searches**: Retrieves paginated list of user searches. |
| `GET` | `/mobile-api/lead-generation/:id` | **Search Detail**: Retrieves single search info with status and prompt. |
| `PUT` | `/mobile-api/lead-generation/:id/prompt` | **Edit Prompt**: Updates generated prompt prior to re-execution. |
| `POST` | `/mobile-api/lead-generation/:id/regenerate` | **Regenerate**: Spawns a new version (`version + 1`) linked to parent. |
| `GET` | `/mobile-api/lead-generation/:id/leads` | **Get Leads**: Returns paginated list of normalized and deduplicated leads. |
| `DELETE` | `/mobile-api/lead-generation/:id` | **Delete**: Soft deletes the search and its associated leads. |

---

## 1. Create Lead Generation Request

Initiates an AI lead generation search. The prompt is automatically constructed, versioned, and pre-stored in MongoDB before being sent to the background queue.

* **URL**: `/mobile-api/lead-generation`
* **Method**: `POST`
* **Auth**: Required (`Bearer <token>`)

### Request Body Schema
| Parameter | Type | Required | Description |
|:---|:---|:---|:---|
| `businessNames` | `string[]` or `string` | **Yes** | 1 to 10 business names or sectors (array or comma-separated string). |
| `locations` | `string[]` or `string` | **Yes** | 1 to 10 target cities, regions, or countries. |
| `additionalRequirement` | `string` | No | Additional requirements or constraints (max 1000 characters). |

#### Request Example
```json
{
  "businessNames": [
    "Solar Panel Manufacturers",
    "Renewable Energy EPC Contractors"
  ],
  "locations": [
    "Chennai",
    "Coimbatore",
    "Bangalore"
  ],
  "additionalRequirement": "Must have ISO 9001 certification and experience with commercial rooftop installations"
}
```

#### Success Response (`201 Created`)
```json
{
  "status": "success",
  "message": "Lead generation request initiated successfully",
  "data": {
    "_id": "6740b1e4c7391a329d91f201",
    "userId": "673f3c4db8631b120f269a91",
    "businessNames": [
      "Solar Panel Manufacturers",
      "Renewable Energy EPC Contractors"
    ],
    "locations": [
      "Chennai",
      "Coimbatore",
      "Bangalore"
    ],
    "additionalRequirement": "Must have ISO 9001 certification and experience with commercial rooftop installations",
    "generatedPrompt": "You are an expert B2B business intelligence and market research specialist...\n<business_names_or_sectors>\n- Solar Panel Manufacturers\n- Renewable Energy EPC Contractors\n</business_names_or_sectors>\n<locations>\n- Chennai\n- Coimbatore\n- Bangalore\n</locations>\n<additional_requirement>\nMust have ISO 9001 certification and experience with commercial rooftop installations\n</additional_requirement>\n...",
    "promptVersion": "1.0",
    "provider": "openai",
    "model": "gpt-4o-mini",
    "status": "PENDING",
    "leadCount": 0,
    "version": 1,
    "isDeleted": false,
    "createdAt": "2026-09-23T08:05:00.000Z",
    "updatedAt": "2026-09-23T08:05:00.000Z"
  }
}
```

---

## 2. List Lead Generation Searches

Retrieves a paginated list of search requests for the logged-in member.

* **URL**: `/mobile-api/lead-generation`
* **Method**: `GET`
* **Auth**: Required (`Bearer <token>`)

### Query Parameters
| Parameter | Type | Required | Default | Description |
|:---|:---|:---|:---|:---|
| `page` | `number` | No | `1` | Page number. |
| `limit` | `number` | No | `10` | Records per page (max 100). |
| `status` | `string` | No | - | Filter by status (`PENDING`, `PROCESSING`, `COMPLETED`, `FAILED`). |

#### Success Response (`200 OK`)
```json
{
  "status": "success",
  "data": {
    "items": [
      {
        "_id": "6740b1e4c7391a329d91f201",
        "userId": "673f3c4db8631b120f269a91",
        "businessNames": [
          "Solar Panel Manufacturers"
        ],
        "locations": [
          "Chennai"
        ],
        "status": "COMPLETED",
        "leadCount": 8,
        "version": 1,
        "createdAt": "2026-09-23T08:05:00.000Z",
        "updatedAt": "2026-09-23T08:05:08.000Z"
      }
    ],
    "total": 1,
    "page": 1,
    "limit": 10,
    "totalPages": 1
  }
}
```

---

## 3. Get Lead Generation Details

Retrieves full metadata for a specific generation search.

* **URL**: `/mobile-api/lead-generation/:id`
* **Method**: `GET`
* **Auth**: Required (`Bearer <token>`)

### URL Path Parameters
| Parameter | Type | Required | Description |
|:---|:---|:---|:---|
| `id` | `string` | **Yes** | 24-character hex ObjectId of the generation request. |

#### Success Response (`200 OK`)
```json
{
  "status": "success",
  "data": {
    "_id": "6740b1e4c7391a329d91f201",
    "userId": "673f3c4db8631b120f269a91",
    "businessNames": [
      "Solar Panel Manufacturers"
    ],
    "locations": [
      "Chennai"
    ],
    "additionalRequirement": "ISO 9001 certified",
    "generatedPrompt": "You are an expert B2B business intelligence...",
    "promptVersion": "1.0",
    "provider": "openai",
    "model": "gpt-4o-mini",
    "status": "COMPLETED",
    "leadCount": 8,
    "version": 1,
    "metadata": {
      "usage": {
        "promptTokens": 320,
        "completionTokens": 540,
        "totalTokens": 860
      },
      "latencyMs": 3412,
      "provider": "openai",
      "model": "gpt-4o-mini"
    },
    "createdAt": "2026-09-23T08:05:00.000Z",
    "updatedAt": "2026-09-23T08:05:08.000Z"
  }
}
```

---

## 4. Edit Prompt

Allows modifying the internal prompt before running a regeneration.

* **URL**: `/mobile-api/lead-generation/:id/prompt`
* **Method**: `PUT`
* **Auth**: Required (`Bearer <token>`)

### Request Body Schema
| Parameter | Type | Required | Description |
|:---|:---|:---|:---|
| `prompt` | `string` | **Yes** | Modified prompt string (min 10 chars, max 5000 chars). |

#### Request Example
```json
{
  "prompt": "You are an expert B2B business intelligence assistant. Identify 10 leading rooftop solar contractors in Chennai and Coimbatore with direct contact numbers and verified websites."
}
```

#### Success Response (`200 OK`)
```json
{
  "status": "success",
  "message": "Prompt updated successfully",
  "data": {
    "_id": "6740b1e4c7391a329d91f201",
    "generatedPrompt": "You are an expert B2B business intelligence assistant. Identify 10 leading rooftop solar contractors in Chennai and Coimbatore with direct contact numbers and verified websites.",
    "status": "PENDING",
    "updatedAt": "2026-09-23T08:10:00.000Z"
  }
}
```

---

## 5. Regenerate Leads

Spawns a **new search record** with incremented version (`version: parent.version + 1`) and references the `parentGenerationId`. Does not overwrite historical data.

* **URL**: `/mobile-api/lead-generation/:id/regenerate`
* **Method**: `POST`
* **Auth**: Required (`Bearer <token>`)

### Request Body Schema (Optional)
| Parameter | Type | Required | Description |
|:---|:---|:---|:---|
| `prompt` | `string` | No | Optional prompt override. If omitted, uses previous prompt. |

#### Request Example
```json
{
  "prompt": "Identify 10 tier-1 solar panel manufacturers in Tamil Nadu with factory addresses and executive contact emails."
}
```

#### Success Response (`201 Created`)
```json
{
  "status": "success",
  "message": "Lead regeneration initiated successfully",
  "data": {
    "_id": "6740b2f5c7391a329d91f205",
    "userId": "673f3c4db8631b120f269a91",
    "businessNames": [
      "Solar Panel Manufacturers"
    ],
    "locations": [
      "Chennai"
    ],
    "generatedPrompt": "Identify 10 tier-1 solar panel manufacturers in Tamil Nadu with factory addresses and executive contact emails.",
    "promptVersion": "1.0",
    "provider": "openai",
    "model": "gpt-4o-mini",
    "status": "PENDING",
    "leadCount": 0,
    "version": 2,
    "parentGenerationId": "6740b1e4c7391a329d91f201",
    "isDeleted": false,
    "createdAt": "2026-09-23T08:12:00.000Z",
    "updatedAt": "2026-09-23T08:12:00.000Z"
  }
}
```

---

## 6. Get Generated Leads

Retrieves structured, normalized, and deduplicated leads produced by a search.

* **URL**: `/mobile-api/lead-generation/:id/leads`
* **Method**: `GET`
* **Auth**: Required (`Bearer <token>`)

### Query Parameters
| Parameter | Type | Required | Default | Description |
|:---|:---|:---|:---|:---|
| `page` | `number` | No | `1` | Page number. |
| `limit` | `number` | No | `20` | Leads per page (max 100). |

#### Success Response (`200 OK`)
```json
{
  "status": "success",
  "data": {
    "items": [
      {
        "_id": "6740b1f2c7391a329d91f202",
        "generationId": "6740b1e4c7391a329d91f201",
        "userId": "673f3c4db8631b120f269a91",
        "businessName": "SunPower Tamil Nadu Ltd",
        "normalizedBusinessName": "sunpower tamil nadu",
        "category": "Solar Manufacturing",
        "locations": [
          "Chennai, Tamil Nadu, India"
        ],
        "phone": "+91-44-28192345",
        "email": "inquiries@sunpowertn.com",
        "website": "https://www.sunpowertn.com",
        "normalizedWebsite": "sunpowertn.com",
        "description": "Leading manufacturer of mono and polycrystalline solar photovoltaic modules with ISO 9001:2015 certification.",
        "confidenceScore": 95,
        "isDeleted": false,
        "createdAt": "2026-09-23T08:05:08.000Z"
      },
      {
        "_id": "6740b1f2c7391a329d91f203",
        "generationId": "6740b1e4c7391a329d91f201",
        "userId": "673f3c4db8631b120f269a91",
        "businessName": "Apex Green Energies",
        "normalizedBusinessName": "apex green energies",
        "category": "EPC Solutions",
        "locations": [
          "Coimbatore, Tamil Nadu, India"
        ],
        "phone": "+91-422-2678123",
        "email": "projects@apexgreen.in",
        "website": "https://apexgreen.in",
        "normalizedWebsite": "apexgreen.in",
        "description": "Specializes in industrial rooftop solar power installations across South India.",
        "confidenceScore": 90,
        "isDeleted": false,
        "createdAt": "2026-09-23T08:05:08.000Z"
      }
    ],
    "total": 2,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

---

## 7. Delete Lead Generation

Soft-deletes a lead generation search and its associated leads.

* **URL**: `/mobile-api/lead-generation/:id`
* **Method**: `DELETE`
* **Auth**: Required (`Bearer <token>`)

#### Success Response (`200 OK`)
```json
{
  "status": "success",
  "data": {
    "success": true,
    "message": "Lead generation deleted successfully"
  }
}
```

---

## 🛑 Common Error Responses

### `400 Bad Request`
Input fails validation checks.
```json
{
  "status": "error",
  "message": "At least one business name/sector is required"
}
```

### `401 Unauthorized`
Missing or invalid authentication token.
```json
{
  "status": "error",
  "message": "Invalid or expired token"
}
```

### `403 Forbidden`
Attempting to view, modify, or delete another user's search.
```json
{
  "status": "error",
  "message": "Unauthorized to access this lead generation request"
}
```

### `404 Not Found`
Resource does not exist or was deleted.
```json
{
  "status": "error",
  "message": "Lead generation request not found"
}
```

### `429 Too Many Requests`
Exceeded hourly rate limit (default 10 generations per hour).
```json
{
  "status": "error",
  "message": "Rate limit exceeded for lead generation. Limit resets at 2026-09-23T09:05:00.000Z"
}
```
