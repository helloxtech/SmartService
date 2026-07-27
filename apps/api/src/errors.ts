import { ZodError } from "zod";

export type ApiStatus = 400 | 401 | 403 | 404 | 409 | 413 | 422 | 500 | 502 | 503;

export class ApiError extends Error
{
    public readonly code: string;
    public readonly details?: unknown;
    public readonly status: ApiStatus;

    /**
     * ApiError
     * ----------------
     * Creates a typed HTTP failure whose public response stays bounded and credential-safe.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    public constructor(status: ApiStatus, code: string, message: string, details?: unknown)
    {
        super(message);
        this.code = code;
        this.details = details;
        this.name = "ApiError";
        this.status = status;
    }
}

/**
 * parseJsonBody
 * ----------------
 * Parses and validates a JSON request while returning stable validation errors instead of raw parser failures.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
export async function parseJsonBody<T>(
    request: Request,
    parser: { parse(input: unknown): T },
): Promise<T>
{
    let input: unknown;

    try
    {
        input = await request.json();
    }
    catch
    {
        throw new ApiError(400, "INVALID_JSON", "The request body must be valid JSON.");
    }

    try
    {
        return parser.parse(input);
    }
    catch (error: unknown)
    {
        if (error instanceof ZodError)
        {
            throw new ApiError(
                422,
                "VALIDATION_ERROR",
                "The request did not pass validation.",
                error.issues.map((issue) => ({
                    message: issue.message,
                    path: issue.path.join("."),
                })),
            );
        }

        throw error;
    }
}

/**
 * requireIdempotencyKey
 * ----------------
 * Requires a bounded idempotency key on an externally retryable write operation.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
export function requireIdempotencyKey(request: Request): string
{
    const value = request.headers.get("idempotency-key")?.trim();

    if (value === undefined || value.length < 8 || value.length > 200)
    {
        throw new ApiError(
            400,
            "IDEMPOTENCY_KEY_REQUIRED",
            "Provide an Idempotency-Key header between 8 and 200 characters.",
        );
    }

    return value;
}
