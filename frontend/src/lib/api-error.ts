/** An error carrying the HTTP status the API responded with. */
export class ApiError extends Error {
    constructor(
        public status: number,
        message: string,
        public details?: unknown,
    ) {
        super(message)
        this.name = 'ApiError'
    }
}

/** Pull a readable message out of whatever the API returned. */
export function messageFrom(error: unknown, fallback = 'Something went wrong.'): string {
    if (error instanceof ApiError) return error.message
    if (error instanceof Error && error.message) return error.message
    return fallback
}
