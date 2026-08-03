import { describe, expect, it } from "vitest";

import { ConversationTokenService } from "../src/conversation-token";

const conversationId = "20000000-0000-4000-a000-000000000001";
const organizationId = "00000000-0000-4000-a000-000000000001";
const secret = "conversation-token-test-secret-that-is-long-enough";

describe("conversation tokens", () =>
{
    it("binds a valid token to one conversation, organization, and scope", async () =>
    {
        const service = new ConversationTokenService(secret, 120);
        const issued = await service.issue(conversationId, organizationId, 1_000);
        const claims = await service.verify(
            issued.token,
            conversationId,
            "conversation:write",
            1_100,
        );

        expect(claims.org).toBe(organizationId);
        expect(claims.sub).toBe(conversationId);
    });

    it("rejects a token used for a different URL conversation", async () =>
    {
        const service = new ConversationTokenService(secret, 120);
        const issued = await service.issue(conversationId, organizationId, 1_000);

        await expect(service.verify(
            issued.token,
            "20000000-0000-4000-a000-000000000002",
            "conversation:read",
            1_100,
        )).rejects.toMatchObject({
            code: "CONVERSATION_TOKEN_INVALID",
            status: 401,
        });
    });

    it("rejects expired and tampered tokens", async () =>
    {
        const service = new ConversationTokenService(secret, 120);
        const issued = await service.issue(conversationId, organizationId, 1_000);

        await expect(service.verify(
            issued.token,
            conversationId,
            "conversation:read",
            1_121,
        )).rejects.toMatchObject({
            code: "CONVERSATION_TOKEN_INVALID",
        });

        const tokenParts = issued.token.split(".");
        const signature = tokenParts[2];

        expect(tokenParts).toHaveLength(3);
        expect(signature).toBeDefined();

        const tamperedSignature = `${signature?.startsWith("A") === true ? "B" : "A"}${signature?.slice(1) ?? ""}`;
        const tampered = `${tokenParts[0]}.${tokenParts[1]}.${tamperedSignature}`;

        await expect(service.verify(
            tampered,
            conversationId,
            "conversation:read",
            1_100,
        )).rejects.toMatchObject({
            code: "CONVERSATION_TOKEN_INVALID",
        });
    });
});
