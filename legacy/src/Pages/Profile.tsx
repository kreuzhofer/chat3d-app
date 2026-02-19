    function claimPatreonBenefits() {
  //   // send get request to patreon api, example: GET www.patreon.com/oauth2/authorize
  //   // ?response_type=code
  //   // &client_id=<your client id>
  //   // &redirect_uri=<one of your redirect_uris that you provided in step 1>
  //   // &scope=<optional list of requested scopes>
  //   // &state=<optional string></optional>
  //   // implement this web request in typescript
  
        window.location.href="https://www.patreon.com/oauth2/authorize?response_type=code&client_id=MvmE1rACZyeWKOpBhynZjK0m4MWkJOKw_SXfo2CZfBFm7N2q9x7_ROzg8ZpAblZ0&redirect_uri=http://localhost:5173/claim-patreon";
    }
    

function Profile()
{
    return (
        <div>
            <h1>Profile</h1>
            <button onClick={claimPatreonBenefits}>Claim Your Patreon Benefits</button>

        </div>
    );
}

export default Profile;
