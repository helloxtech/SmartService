import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./lib/supabase", () =>
{
    return {
        getSupabaseClient: async () => null,
    };
});

import { App } from "./app";

describe("App", () =>
{
    it("renders the sign-in shell without configured provider values", async () =>
    {
        render(<App />);

        expect(screen.getByRole("heading", { name: /Sign in to SmartService/u })).toBeInTheDocument();
        expect(await screen.findByText(/Supabase configuration is not available yet/u)).toBeInTheDocument();
        expect(screen.getByLabelText(/Email/u)).toBeInTheDocument();
        expect(screen.getByLabelText(/Password/u)).toBeInTheDocument();
    });
});
