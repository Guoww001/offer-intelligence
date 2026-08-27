import "./shared/styles/modern-root.css";

import { createModernAppApi } from "./legacy/bridge";

window.OI_MODERN_APP = createModernAppApi();
