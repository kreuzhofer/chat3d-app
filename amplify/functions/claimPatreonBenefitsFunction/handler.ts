import type { Schema } from "../../data/resource"
import { env } from "$amplify/env/claimPatreonBenefitsFunction";

interface PatreonTokenResponse {
  access_token: string;
}

class PatreonApiClient {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  async get(resource: string): Promise<any> {
    const response = await fetch(`https://www.patreon.com/api/oauth2/v2/${resource}`, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Error fetching data from Patreon API: ${response.statusText}`);
    }

    return response.json();
  }
}

async function requestPatreonAccessToken(oauthGrantCode: string): Promise<PatreonTokenResponse> {
  const CLIENT_ID = env.PATREON_CLIENT_ID;
  const CLIENT_SECRET = env.PATREON_CLIENT_SECRET;
  const redirectURL = env.PATREON_REDIRECT_URI;

  const tokenRequestBody = new URLSearchParams({
    code: oauthGrantCode,
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: redirectURL,
  });

  const tokenResponse = await fetch("https://www.patreon.com/api/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: tokenRequestBody,
  });

  if (!tokenResponse.ok) {
    throw new Error(`Failed to exchange Patreon OAuth code: ${tokenResponse.status} ${tokenResponse.statusText}`);
  }

  return (await tokenResponse.json()) as PatreonTokenResponse;
}

async function handleOAuthRedirectRequest(oauthGrantCode: string): Promise<any> {
  const tokensResponse = await requestPatreonAccessToken(oauthGrantCode);
  const patreonAPIClient = new PatreonApiClient(tokensResponse.access_token);
  let requestParameters = "include=memberships.currently_entitled_tiers,memberships.campaign&fields[user]=email,first_name,full_name,image_url,last_name,thumb_url,url,vanity,is_email_verified&fields[member]=currently_entitled_amount_cents,lifetime_support_cents,campaign_lifetime_support_cents,last_charge_status,patron_status,last_charge_date,pledge_relationship_start,pledge_cadence";
  requestParameters = requestParameters.replaceAll("[", "%5B").replaceAll("]", "%5D");
  return patreonAPIClient.get(`identity?${requestParameters}`);
}

export const handler: Schema["claimPatreonBenefits"]["functionHandler"] = async (event) => {
  const { code } = event.arguments;
  if (!code) {
      throw new Error("Code is required");
  }
  console.log("code: "+code);

  const oauthResult = await handleOAuthRedirectRequest(code);
  console.log("oauthResult: "+oauthResult);

  return oauthResult
}
