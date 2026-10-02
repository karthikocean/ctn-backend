/**
 * Internal Trusted Network API service for MCP tools.
 *
 * This module is the sole bridge between MCP tool handlers and the
 * existing Trusted Network backend. It:
 *
 *  1. Generates a short-lived internal JWT on behalf of the authenticated member.
 *  2. Calls the existing /mobile-api routes with that JWT.
 *  3. Never exposes the internal JWT or DB credentials to ChatGPT.
 *  4. Normalises responses to clean data objects for MCP tools.
 *
 * The existing backend remains the single source of truth:
 *  - Ownership checks, visibility rules, rate limits — all enforced server-side.
 *  - MCP adds zero new business logic — it's a pure proxy layer.
 */

import axios, { AxiosInstance } from "axios";
import { mcpConfig } from "../config";
import { generateInternalJwt } from "../auth/token";
import { toMcpError } from "../utils/errors";

const TIMEOUT_MS = 10_000;

/**
 * Creates a per-request Axios instance with a short-lived JWT for a member.
 * The JWT expires in 5 minutes — sufficient for a single MCP tool call round-trip.
 */
function createApiClient(memberId: string): AxiosInstance {
  const internalToken = generateInternalJwt(memberId);
  return axios.create({
    baseURL: mcpConfig.apiUrl,
    timeout: TIMEOUT_MS,
    headers: {
      Authorization: `Bearer ${internalToken}`,
      "Content-Type": "application/json",
      "x-mcp-internal": "1"  // Identifier header for logging/filtering on the main server
    }
  });
}

// ── Member / Profile ──────────────────────────────────────────────────────────

export async function getMyProfile(memberId: string) {
  try {
    const api = createApiClient(memberId);
    const response = await api.get("/mobile-api/members/profile");
    return response.data.data;
  } catch (err) {
    throw toMcpError(err, "getMyProfile");
  }
}

export async function searchMembers(
  memberId: string,
  params: {
    search?: string;
    city?: string;
    state?: string;
    category?: string;
    region?: string;
    page?: number;
    limit?: number;
  }
) {
  try {
    const api = createApiClient(memberId);
    const response = await api.get("/mobile-api/members/", { params });
    return response.data;
  } catch (err) {
    throw toMcpError(err, "searchMembers");
  }
}

export async function getNearbyMembers(
  memberId: string,
  params: {
    lat?: number;
    lng?: number;
    radius?: 5 | 10;
    page?: number;
    limit?: number;
  }
) {
  try {
    const api = createApiClient(memberId);
    const response = await api.get("/mobile-api/members/nearby", { params });
    return response.data;
  } catch (err) {
    throw toMcpError(err, "getNearbyMembers");
  }
}

export async function getMember(memberId: string, targetMemberId: string) {
  try {
    const api = createApiClient(memberId);
    const response = await api.get(`/mobile-api/members/${targetMemberId}`);
    return response.data.data;
  } catch (err) {
    throw toMcpError(err, "getMember");
  }
}

// ── Posts ────────────────────────────────────────────────────────────────────

export async function getMyPosts(
  memberId: string,
  params: {
    type?: "PROMOTION" | "GIVE" | "ASK" | "REQUIREMENT";
    page?: number;
    limit?: number;
  }
) {
  try {
    const api = createApiClient(memberId);
    const response = await api.get("/mobile-api/posts/my-posts", { params });
    return response.data;
  } catch (err) {
    throw toMcpError(err, "getMyPosts");
  }
}

export async function getPost(memberId: string, postId: string) {
  try {
    const api = createApiClient(memberId);
    const response = await api.get(`/mobile-api/posts/${postId}`);
    return response.data.data;
  } catch (err) {
    throw toMcpError(err, "getPost");
  }
}

export interface CreatePostInput {
  type: "PROMOTION" | "GIVE" | "ASK" | "REQUIREMENT";
  title: string;
  description: string;
  location?: string;
  period?: string;
  requirementVisibility?: "MUTUAL-FRIEND" | "REGION" | "OVERALL";
}

export async function createPost(memberId: string, input: CreatePostInput) {
  try {
    const api = createApiClient(memberId);
    const response = await api.post("/mobile-api/posts/", input);
    return response.data.data;
  } catch (err) {
    throw toMcpError(err, "createPost");
  }
}

export interface UpdatePostInput {
  title?: string;
  description?: string;
  location?: string;
  period?: string;
  requirementVisibility?: "MUTUAL-FRIEND" | "REGION" | "OVERALL";
}

export async function editPost(memberId: string, postId: string, input: UpdatePostInput) {
  try {
    const api = createApiClient(memberId);
    const response = await api.put(`/mobile-api/posts/${postId}`, input);
    return response.data.data;
  } catch (err) {
    throw toMcpError(err, "editPost");
  }
}

export async function deletePost(memberId: string, postId: string) {
  try {
    const api = createApiClient(memberId);
    const response = await api.delete(`/mobile-api/posts/${postId}`);
    return response.data;
  } catch (err) {
    throw toMcpError(err, "deletePost");
  }
}
