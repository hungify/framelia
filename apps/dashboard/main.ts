import "@fontsource-variable/geist";
import "@fontsource-variable/jetbrains-mono";
import { createApp } from "vue";

import App from "./App.vue";
import { router } from "./router";

import "./styles.css";

createApp(App).use(router).mount("#app");
