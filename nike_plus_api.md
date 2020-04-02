# NikePlus API

This documentation is based on the work of
[Yoshimasa Niwa - fetch_nike_puls_all_activities.bash](https://gist.github.com/niw/858c1ecaef89858893681e46db63db66) with some edits to how the Bearer token is retrieved.

Since NikePlus and the Nike NRC app don't provide an export functionality (except for some payed partner solutions) I think they actually break the GDPR laws in Europe. But if you manage to get access to the API used by their app there is a simple HTTP/JSON API and you can fetch all metrics from their website.

To acquire the access, the API is using OAuth 2.0, thus need to get an access token, which is not easy by using normal OAuth authorization steps because we can't create client ID for their API. However, `nike.com` and their website itself is using same API and it's really easy to get your own access token from the response.

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

If we can get this `Bearer` token, then we can call their API to fetch all metrics.

## API Endpoints

There are bunch of API endpoints to access historical metrics however, there are only two API endpoints which we need to fetch past run metrics.

### `/sport/v3/me/activities/after_time/${time}`

Use this endpoint first to start fetching activities, by giving `0` as a `time`. `time` is an integer value of UNIX epoc milliseconds.

#### Request

    $ curl -v -H 'Authorization: Bearer ${bearer_token}' 'https://api.nike.com/sport/v3/me/activities/after_time/0'

#### Response

    {
      "activities": [
        {
          id: "${activity_uuid}"
        },
        ...
      ],
      "paging": {
        "after_time": ${after_time},
        "after_id": "${after_activity_uuid}"
      }
    }

This API response returns limited amount of latest activities from the given time. Thus, we might need to paginate to get older activities. In that case, you might see `after_id` key in `paging`.

### `/sport/v3/me/activities/after_id/${before_activity_uuid}`

Use this endpoint to fetch another list activities to reach beginning. If `paging` has *only* `before_id` key, then it is last page.

### `/sport/v3/me/activity/${activity_uuid}?metrics=ALL`

To get GPS locations, heart rates and detailed activity metrics, use this API endpoint with `activity_uuid`, that we can get by `sport/v3/me/activities/` endpoint.
Give `metrics=ALL` to get all details of the activity metrics.

#### Request

    $ curl -v -H 'Authorization: Bearer ${bearer_token}' 'https://api.nike.com/sport/v3/me/activity/${activity_uuid}?metrics=ALL'

#### Response

    {
      "id": "${activity_uuid}",
      "type": "run",
      ...
      "summaries": [
        {
          "metric": "distance",
          ...
        },
        ...
      ],
      ...
      "metric_types": [
        "distance",
        "rpe",
        "pace",
        "latitude",
        "heart_rate",
        "calories",
        "nikefuel",
        "speed",
        "longitude"
      ],
      "metrics": [
        {
          "type": "distance",
          "unit": "KM",
          ...
          "values": [
            {
              ...
            },
            ...
          ]
        },
        ...
      ],
      "moments": [
        ...
      ]
    }

Here, `metrics` contains all detailed metrics of distance, latitude and longitude etc.
