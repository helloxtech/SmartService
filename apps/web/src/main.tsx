import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app";
import { installHelloXFeedback } from "./hellox-feedback";
import "./styles.css";

const rootElement = document.getElementById("root");

if (rootElement === null)
{
    throw new Error("SmartService root element is missing.");
}

createRoot(rootElement).render(
    <StrictMode>
        <App />
    </StrictMode>,
);

void installHelloXFeedback();
