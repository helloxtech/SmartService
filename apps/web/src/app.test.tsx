import {
    cleanup,
    render,
    screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

vi.mock("./lib/supabase", () =>
{
    return {
        getSupabaseClient: async () => null,
    };
});

import { App } from "./app";

beforeEach(() =>
{
    localStorage.clear();
});

afterEach(() =>
{
    cleanup();
});

describe("App", () =>
{
    it("renders the sign-in shell without configured provider values", async () =>
    {
        render(<App />);

        expect(screen.getByRole("heading", { name: /Sign in to Smart Service/u })).toBeInTheDocument();
        expect(await screen.findByText(/Supabase configuration is not available yet/u)).toBeInTheDocument();
        expect(screen.getByLabelText(/Email/u)).toBeInTheDocument();
        expect(screen.getByLabelText(/Password/u)).toBeInTheDocument();
    });

    it("switches the visible shell copy between English and Chinese", async () =>
    {
        const user = userEvent.setup();
        render(<App />);

        await user.click(screen.getByRole("button", { name: "中文" }));

        expect(screen.getByRole("heading", { name: /登录 Smart Service/u })).toBeInTheDocument();
        expect(screen.getByLabelText(/邮箱/u)).toBeInTheDocument();
        expect(screen.queryByRole("heading", { name: /Sign in to Smart Service/u }))
            .not.toBeInTheDocument();
    });
});
