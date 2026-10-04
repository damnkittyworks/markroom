import * as EmbedPdfModule from "./embedpdf.js";

window.__markroomEmbedPdfModule = EmbedPdfModule;
window.dispatchEvent(new CustomEvent("markroom:embedpdf-module-ready"));
