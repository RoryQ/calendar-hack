import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./css/reset.css";
import "./index.css";
import Index from "./Index";
import App from "./App";
import { DndProvider } from "react-dnd-multi-backend";
import { HTML5toTouch } from "rdndmb-html5-to-touch";
import { QueryParamProvider } from "use-query-params";
import { ReactRouter6Adapter } from "use-query-params/adapters/react-router-6";
import { HashRouter, Routes, Route } from "react-router-dom";
import About from "./About";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DndProvider options={HTML5toTouch}>
      <HashRouter>
        <QueryParamProvider adapter={ReactRouter6Adapter}>
          <div className="app">
            <Routes>
              <Route path="/" element={<Index />}>
                <Route index path="/" element={<App />} />
                <Route path="about" element={<About />} />
              </Route>
            </Routes>
          </div>
        </QueryParamProvider>
      </HashRouter>
    </DndProvider>
  </StrictMode>,
);
