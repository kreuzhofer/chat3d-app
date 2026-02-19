import { BrowserRouter, Route, Routes } from "react-router";
import Layout from "./Pages/Layout";
import Chat from "./Pages/Chat";
import Profile from "./Pages/Profile";
import ClaimPatreon from "./Pages/ClaimPatreon";
import { ResponsivenessProvider } from "react-responsiveness";
import mixpanel from 'mixpanel-browser'
//import Home from "./Pages/Home";

if (process.env.MIXPANEL_TOKEN)
  mixpanel.init(process.env.MIXPANEL_TOKEN, { track_pageview: "full-url" });

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          {/* {process.env.REACT_APP_ENV === "local" ? (
            <Route index element={<Chat />} />
            ) : (
            <Route index element={<Home />} />
          )} */}
          <Route index element={<Chat />} />

          <Route path="/chat/:chatId?" element={<Chat />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/claim-patreon" element={<ClaimPatreon />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

const WithResponsiveness = () => (
  <ResponsivenessProvider>
    <App />
  </ResponsivenessProvider>
);
export default WithResponsiveness;