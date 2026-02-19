//import 'semantic-ui-css/semantic.min.css';
import React from "react";
import ReactDOM from "react-dom/client";
import WithResponsiveness from "./App.tsx";
import { Amplify } from "aws-amplify";
import outputs from "../amplify_outputs.json";
import { Authenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import "./index.css";
Amplify.configure(outputs);
//const isDev = import.meta.env.DEV;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* <Authenticator hideSignUp={!isDev}> */}
    <Authenticator>
      <WithResponsiveness />
    </Authenticator>
  </React.StrictMode>
);
