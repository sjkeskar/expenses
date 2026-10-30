import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App as AntApp, ConfigProvider } from "antd";
import enGB from "antd/locale/en_GB";
import App from "./App";
import "antd/dist/reset.css"; // antd's base stylesheet: no browser margins, consistent box sizing
import "./index.css";

// antd's default look (pivot.md §12.2), except where its default colours
// fall short of WCAG AA contrast (4.5:1) — the axe specs check every
// screen. Those take antd's own next-darker shade of the same colour.
const ACCESSIBLE_COLOURS = {
  colorPrimary: "#0958d9", // blue-7 instead of blue-6
  colorLink: "#0958d9", // links and link-style buttons, likewise
  colorLinkHover: "#003eb3", // blue-8: antd's lighter hover blue misses contrast
  colorError: "#cf1322", // red-7 instead of red-5
  colorSuccess: "#237804", // green-8 instead of green-6
  colorTextSecondary: "rgba(0, 0, 0, 0.65)",
  colorTextTertiary: "rgba(0, 0, 0, 0.62)",
  colorTextDescription: "rgba(0, 0, 0, 0.62)",
  colorTextPlaceholder: "rgba(0, 0, 0, 0.55)",
};

// An empty table's text ("No bills yet") is drawn in the disabled-text
// colour, too faint to read; tables use the placeholder grey instead.
const TABLE = { colorTextDisabled: ACCESSIBLE_COLOURS.colorTextPlaceholder };

// Motion is off for anyone whose OS asks for reduced motion, which also
// keeps the UI tests deterministic.
const motion = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConfigProvider locale={enGB} theme={{ token: { motion, ...ACCESSIBLE_COLOURS }, components: { Table: TABLE } }}>
      <AntApp>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  </StrictMode>
);
