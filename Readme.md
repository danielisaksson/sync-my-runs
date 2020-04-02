
# SyncMyRuns

This project helps me with syncing runs from Nike plus (NRC) app to Strava.
The project is using the Nike API. Read about how to access the Nike API [here](nike_plus_api.md)


## Build Setup

``` bash
# install dependencies
$ npm install # Or yarn install
```

### Setup untracked files and folders

Add an `exports` folder in the project. This folder will contain your exported `GPX` files and will not be tracked by Git.

Add an `config.json` file in the project. Update this file with your own credentials. This file is not tracked on Git either.

```json
{
    "nike": {
        "user_id": "YOUR USER ID",
        "client_id": "YOUR CLIENT ID",
        "access_token": "YOUR ACCESS TOKEN",
        "refresh_token": "YOUR REFRESH TOKEN",
        "expires_at": 1585813777563
    },
    "strava": {
        "client_id": "YOUR CLIENT ID",
        "client_secret": "YOUR CLIENT SECRET",
        "access_token": "YOUR ACCESS TOKEN",
        "refresh_token": "YOUR REFRESH TOKEN",
        "expires_at": 1585831778000
    }
}
```

---


## Step 1 - Get the Bearer token from Nike.com

Go to the [Nike website](https://www.nike.com) and open the Chrome dev tools. Filter Network requests on XHR to unite.nike.com/login.

Log in to the website. Now you should see a POST request to the login endpoint. The result of that request is a returned object with the login credentials.
```javascript
{
    "user_id":"00000000",
    "access_token":"xxxxxxxxxxx",
    "refresh_token":"xxxxxxxxx",
    "expires_in":"3600",
    "token_type":"bearer"
}
```

What you want is the `access_token`. The token is valid for one hour so you also need the `refresh_token` and the expiration time.
Copy that info to the `config.json` file. The `expires_at` value is a UNIX timestamp in milliseconds so to calculate when the Nike token expires you need to take the current Unix timestamp and add the `expires_in` value (in seconds) from Nike times 1000.

```javascript
{
    "nike": {
        "user_id": "XXXXXXXXXX",
        "client_id": "XXXXXXXXXX",
        "access_token": "XXXXXXXXXX",
        "refresh_token": "XXXXXXXXXX",
        "expires_at": 1585560001642
    },
    ...
}
```

## Step 2 - The Strava API

This flow is documented in the Strava developers Getting started guide https://developers.strava.com/docs/getting-started.

Ceate an application at https://developers.strava.com/. Use 'localhost' as Authorization Callback Domain in the application settings.

Copy your `client_id` and `client_secret` from the Strava app page to the `config.js` file.

```javascript
{
    "nike": {
        "user_id": "XXXXXXXXXX",
        "client_id": "XXXXXXXXXX",
        "access_token": "XXXXXXXXXX",
        "refresh_token": "XXXXXXXXXX",
        "expires_at": 1585560001642
    },
    "strava": {
        "client_id": "xxxxx",
        "client_secret": "XXXXXXXXXX",
        "access_token": "XXXXXXXXXX",
        "refresh_token": "XXXXXXXXXX",
        "expires_at": 1585578002000
    }
}
```

Now you need to begin an OAuth flow to set the correct scopes of your Strava app. You get an access token directly aftr signing up but that only has a `read` scope and in this case you want both `activity:write` and `activity:read`. 

To open the OAuth Authorization page with the correct scopes you use the following link with your Strava `client_id`.

```
https://www.strava.com/oauth/authorize?client_id={{YOUR_CLIENT_ID}}&redirect_uri=http://localhost&response_type=code&approval_prompt=force&scope=read_all,activity:read,activity:write
```

After accepting the scopes the page will redirect to a localhost URL where you probably will see a 404 message unless you have built that page. That's OK, you just need the data from the URL in this case. Copy the `code` parameter, you will use that to exchange for a long lived access token.

Example of OAuth redirect:
```
Redirects to: http://localhost/?state=&code=7dba92777ad516813c78a6033c486b1621ce9221&scope=read,activity:write,activity:read,read_all
```

Make a cURL request to exchange the authorization code and scope for a refresh token, access token, and access token expiration date. Replace the `client_secret` and `code`. The response should include the refresh token, access token, and access token expiration date.

Sample cURL request:
```
	curl -X POST https://www.strava.com/oauth/token \
	-F client_id=YOURCLIENTID \
	-F client_secret=YOURCLIENTSECRET \
	-F code=AUTHORIZATIONCODE \
	-F grant_type=authorization_code
```

The response will look something like this:
```javascript
{
    "token_type": "Bearer",
    "expires_at": 1562908002,
    "expires_in": 21600,
    "refresh_token": "REFRESHTOKEN",
    "access_token": "ACCESSTOKEN",
    "athlete": {
        "id": 123456,
        "username": "MeowTheCat",
        "resource_state": 2,
        "firstname": "Meow",
        "lastname": "TheCat",
        "city": "",
        "state": "",
        "country": null,
        ...
    }
}
```

Copy the `expires_at`, `refresh_token` and `access_token` to the `config.json` file.

## Step 3 - Sync activities from Nike to Strava

Well, that's what this script is for.

To sync the latest activities from Nike to Strava, using the latest Strava activity as the start time for syncing:
```bash
npm run sync
```

To just download the latest activities from Nike and save them as `.gpx` files, using the latest Strava activity as the start time for syncing:
```bash
npm run download
```

To sync all activities from Nike to Strava:
```bash
npm run sync-all
```

The script takes some options:
```
    -c, --config,  Path to the config file to use Defaults to './config.json'
    -o, --output,  Path to the folder to save exported GPX files in. Defaults to './'
    -d, --date,  The UNIX timestamp from when you want to sync. Use '0' if you want to sync all activities. Defaults to the latest Strava activity.
    -u, --no-upload, Upload to Strava (optional). Defaults to true
```


## The process

Depending on the options the script will do the following when syncing:

1. Read the `config.json` file
2. Check if the Nike `access_token` needs to be refreshed by comparing the `expires_at` timestamp with the current time.
3. If the token has expired a new token is generated using the `refresh_token` and the `config` JSON file is updated with the new tokens and timestamp.
4. Same process is repeated for Strava.
5. The last activity is fetched from Strava if no `--date` option is used
6. All activities more recent than the latest activity on Strava or the `-date` timestamp are fetched from Nike.
7. Manual entries in Nike NRC doesn't contain any metrics and can't be fetched.
8. The Nike activities are converted to `GPX` format and saved to the `exports` folder.
9. All new activities are uploaded to Strava unless the `--no-upload` flag is used
10. Done!
