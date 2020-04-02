var fs = require('fs')
var FormData = require('form-data')
const commander = require('commander')
const axios = require('axios')

commander
    .version('1.0.0', '-v, --version')
    .usage('[OPTIONS]...')
    .option('-c, --config <config>', 'Path to the config file to use', './config.json')
    .option('-o, --output <output>', 'Path to the folder where to save exported GPX files', './')
    .option('-d, --date <date>', 'The UNIX timestamp from when you want to sync (optional)')
    .option('-u, --no-upload', 'Upload to Strava (optional). Defaults to true')
    .parse(process.argv)


console.log(`Using ${commander.config} as path to the config file`)
console.log(`Using ${commander.output} as path to the output folder`)
console.log(`Using ${commander.date || 'latest activity on Strava'} as timestamp for fetching Nike activities`)
if (commander.upload) console.log(`Will upload new activities to Strava`)
else console.log(`Will NOT upload new activities to Strava`)


// const inputPath = './activities'
const outputPath = commander.output //'./exports'


const nikeAuthRequest = axios.create({
    baseURL: 'https://unite.nike.com',
    headers: {
        'Content-Type': 'application/json'
    }
})
nikeAuthRequest.interceptors.response.use(response => response.data)

const nikeAPIRequest = axios.create({
    baseURL: 'https://api.nike.com/sport/v3/me'
})
nikeAPIRequest.interceptors.response.use(response => response.data)


const stravaAuthRequest = axios.create({
    baseURL: 'https://www.strava.com/oauth',
    headers: {
        'Content-Type': 'application/json'
    }
})
stravaAuthRequest.interceptors.response.use(response => response.data)

const stravaAPIRequest = axios.create({
    baseURL: 'https://www.strava.com/api/v3'
})
stravaAPIRequest.interceptors.response.use(response => response.data)


init()

async function init() {
    try {
        const configFile = JSON.parse(fs.readFileSync(`${commander.config}`, 'utf8'))
        if (!configFile || !configFile.nike) throw (new Error('No config file found'))
        else console.log('configFile read')

        const nowDate = new Date()
        const current_timestamp = nowDate.getTime()

        console.log(`current_timestamp : ${current_timestamp}, Nike expires_at: ${configFile.nike.expires_at}, Needs token refresh: ${configFile.nike.expires_at <= current_timestamp}`)
        console.log(`current_timestamp : ${current_timestamp}, Strava expires_at: ${configFile.strava.expires_at}, Needs token refresh: ${configFile.strava.expires_at <= current_timestamp}`)


        if (!configFile.nike.access_token || configFile.nike.expires_at <= current_timestamp) {
            console.log('Time to update the Nike token')
            /*             let nikeAuthUpdateStatus = await updateNikeAuthentication(configFile)
                        if (!nikeAuthUpdateStatus) {
                            console.log('Unable to update Nike authentication')
                            process.exit(1)
                        }
             */
            if (configFile.nike.refresh_token) {
                const nikeRefreshTokenResponse = await refreshNikeToken(configFile.nike.refresh_token)
                if (nikeRefreshTokenResponse && nikeRefreshTokenResponse.access_token) {

                    configFile.nike.access_token = nikeRefreshTokenResponse.access_token
                    configFile.nike.refresh_token = nikeRefreshTokenResponse.refresh_token
                    configFile.nike.user_id = nikeRefreshTokenResponse.user_id
                    configFile.nike.expires_at = current_timestamp + Number(nikeRefreshTokenResponse.expires_in * 1000)

                    console.log('Nike tokens refreshed')
                }
            } else {
                console.log('No Nike refresh token in the config file')
                process.exit(1)
            }
        }

        if (!configFile.strava.access_token || configFile.strava.expires_at <= nowDate.getTime()) {
            console.log('Time to update the strava token')
            if (configFile.strava.refresh_token) {
                const stravaRefreshTokenResponse = await refreshStravaToken(configFile.strava.refresh_token, configFile.strava.client_id, configFile.strava.client_secret)
                if (stravaRefreshTokenResponse && stravaRefreshTokenResponse.access_token) {

                    configFile.strava.access_token = stravaRefreshTokenResponse.access_token
                    configFile.strava.refresh_token = stravaRefreshTokenResponse.refresh_token
                    configFile.strava.user_id = stravaRefreshTokenResponse.user_id
                    configFile.strava.expires_at = stravaRefreshTokenResponse.expires_at * 1000

                    console.log('strava tokens refreshed')
                }
            } else {
                console.log('No strava refresh token in the config file')
                process.exit(1)
            }
        }

        stravaAPIRequest.defaults.headers.common['Authorization'] = `Bearer ${configFile.strava.access_token}`
        nikeAPIRequest.defaults.headers.common['Authorization'] = `Bearer ${configFile.nike.access_token}`

        fs.writeFileSync(`${commander.config}`, JSON.stringify(configFile))
        console.log('Tokens refreshed and written to the config file, all good to go')

        /* 
                GET STRAVA DATA
         */

        let startSyncDate
        if (commander.date) {
            console.log(`commander.date ${commander.date}`)
            startSyncDate = new Date(Number(commander.date))
        } else {
            // Get the latest Strava run
            const stravaActivities_result = await stravaAPIRequest.get('/athlete/activities?per_page=1')
            // console.log(stravaActivities_result)

            const latestStravaRunStart = stravaActivities_result[0].start_date
            startSyncDate = new Date(latestStravaRunStart)
            console.log(`latestStravaRunStart: ${latestStravaRunStart}`)
        }


        /* 
                GET NIKE DATA THAT IS MORE RECENT THAN STRAVA
         */


        const nikeActivities_result = await getNikeActivitiesListByTime(startSyncDate.getTime())
        //        const nikeActivities_result = await nikeAPIRequest.get(`/activities/after_time/${startSyncDate.getTime()}`)
        if (!nikeActivities_result) {
            console.log('Couldn\'t find any new Nike activities')
            process.exit(1)
        }

        let after_activity_uuid = (nikeActivities_result.paging && nikeActivities_result.paging.after_id) ? nikeActivities_result.paging.after_id : null
        while (after_activity_uuid) {
            console.log(`iterating more pages after ID ${after_activity_uuid}`)
            let activities_result_page = await getNikeActivitiesListByID(after_activity_uuid)

            //                let activities_result_page = await nikeAPIRequest.get(`/activities/after_id/${after_activity_uuid}`)
            if (activities_result_page.paging && activities_result_page.paging.after_id) {
                after_activity_uuid = activities_result_page.paging.after_id
            } else {
                after_activity_uuid = null
            }

            nikeActivities_result.activities.push(...activities_result_page.activities)
        }


        /*
                 GENERATE GPX FILES
         */


        nikeActivities_result.activities.forEach(async activity => {

            if (activity.id) {
                let res = await getNikeActivityByID(activity.id)
                if (res) {
                    let filename = `activity-${res.id}`
                    let output = generateGPXOutput(res)

                    if (output) {
                        fs.writeFileSync(`${outputPath}/${filename}.gpx`, output)
                        console.log(`file written "${outputPath}/${filename}.gpx"`)
                    }

                    if (output && commander.upload) {
                        let activityname = res.tags['com.nike.name'] || ''
                        await uploadToStrava(filename, activityname, res.id)
                    }
                }
            } else {
                console.log('ERROR NO ID FOR ACTIVITY', activity)
            }

        })

    } catch (error) {
        console.error(error);
    }
}

async function refreshNikeToken(refresh_token) {
    console.log(`refreshNikeToken with: ${refresh_token}`)
    try {
        const response = await nikeAuthRequest.post(`/tokenRefresh?appVersion=727&experienceVersion=727&uxid=com.nike.commerce.nikedotcom.web&locale=sv_SE&backendEnvironment=identity`, {
            'refresh_token': `${refresh_token}`,
            'client_id': 'HlHa2Cje3ctlaOqnxvgZXNaAs7T9nAuH',
            'grant_type': 'refresh_token'
        })
        return response
    } catch (error) {
        console.error(error)
        return
    }
}

/* async function updateNikeAuthentication(configFile) {
    if (configFile.nike.refresh_token) {
        const nikeRefreshTokenResponse = await refreshNikeToken(configFile.nike.refresh_token)
        if (nikeRefreshTokenResponse && nikeRefreshTokenResponse.access_token) {

            configFile.nike.access_token = nikeRefreshTokenResponse.access_token
            configFile.nike.refresh_token = nikeRefreshTokenResponse.refresh_token
            configFile.nike.user_id = nikeRefreshTokenResponse.user_id
            configFile.nike.expires_at = new Date().getTime() + Number(nikeRefreshTokenResponse.expires_in * 1000)
        }
        nikeAPIRequest.defaults.headers.common['Authorization'] = `Bearer ${configFile.nike.access_token}`
        fs.writeFileSync(`${commander.config}`, JSON.stringify(configFile))
        console.log('Nike tokens refreshed')
        return true
    } else {
        console.log('No Nike refresh token in the config file')
        return false
    }
} */


async function refreshStravaToken(refresh_token, client_id, client_secret) {
    console.log(`refreshStravaToken with: ${refresh_token}`)
    try {
        const response = await stravaAuthRequest.post(`/token`, {
            'client_id': `${client_id}`,
            'client_secret': `${client_secret}`,
            'grant_type': 'refresh_token',
            'refresh_token': `${refresh_token}`
        })
        return response
    } catch (error) {
        console.error(error)
        return
    }
}

async function getNikeActivitiesListByTime(after) {
    try {
        const response = await nikeAPIRequest.get(`/activities/after_time/${after}`)
        return response
    } catch (error) {
        console.log(`ERROR WHILE LOADING ACTIVITY LISTS AFTER ${after}`)
        if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            console.log(error.response.data)
            console.log(error.response.status)
            console.log(error.response.headers)
        } else if (error.request) {
            // The request was made but no response was received
            // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
            // http.ClientRequest in node.js
            console.log(error.request)
        } else {
            // Something happened in setting up the request that triggered an Error
            console.log('Error', error.message)
        }
        console.log(error.config)
        return false
    }
}

async function getNikeActivitiesListByID(id) {
    try {
        const response = await nikeAPIRequest.get(`/activities/after_id/${id}`)
        return response
    } catch (error) {
        console.log('ERROR WHILE LOADING ACTIVITY LISTS', error)
        return false
    }
}

async function getNikeActivityByID(id) {
    try {
        const response = await nikeAPIRequest.get(`/activity/${id}?metrics=ALL`)
        return response
    } catch (error) {
        console.log(`ERROR WHILE LOADING ACTIVITY ${id}`)
        if (error.response && error.response.status === 403) {
            console.log(`NO METRIC DATA AVAILABLE`)
        } else if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            // console.log(error.response.data)
            console.log(error.response.status)
            // console.log(error.response.headers)
        } else if (error.request) {
            // The request was made but no response was received
            // `error.request` is an instance of XMLHttpRequest in the browser and an instance of
            // http.ClientRequest in node.js
            console.log(error.request)
        } else {
            // Something happened in setting up the request that triggered an Error
            console.log('Error', error.message)
        }
        return false
    }
}

function generateGPXOutput(activity) {
    let {
        id,
        metric_types,
        end_epoch_ms,
        metrics,
        tags
    } = activity

    let filename = `activity-${id}`

    if (!metric_types || !metric_types.includes('latitude')) {
        console.log(`INFO no location data found in ${filename}`)
        return false
    }

    let hasElevationData = metric_types.includes('elevation')
    if (!hasElevationData) console.log(`INFO No elevation data in ${activity.id}`)

    if (!metrics) {
        console.log(`INFO no metrics found in ${filename}`)
        return false
    }

    let enddate = new Date(end_epoch_ms)
    let activityname = tags['com.nike.name'] || ''
    let latitudes = metrics.filter(metric => metric.type == 'latitude').flatMap(metric => metric.values)
    let longitudes = metrics.filter(metric => metric.type == 'longitude').flatMap(metric => metric.values)
    let elevations
    if (hasElevationData) {
        elevations = metrics.filter(metric => metric.type == 'elevation').flatMap(metric => metric.values)
    }

    let output = '<?xml version="1.0" encoding="UTF-8"?>\n'
    output += `<gpx creator="Nike NRC app" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd" version="1.1" xmlns="http://www.topografix.com/GPX/1/1">\n`
    output += `  <metadata>\n    <time>${enddate.toISOString()}</time>\n  </metadata>\n`
    output += `  <trk>\n    <name>${activityname}</name>\n    <type>9</type>\n    <trkseg>\n`

    let trkptTime = new Date()
    let elevationIndex = 0
    let elevation = 0

    if (hasElevationData) {
        let elevation = elevations[0].value
    }

    latitudes.forEach((element, index) => {

        if (hasElevationData) {
            while (element.start_epoch_ms > elevations[elevationIndex].start_epoch_ms && elevationIndex < elevations.length) {
                elevationIndex++
            }
            elevation = elevations[elevationIndex].value
        }

        // console.log(index, elevationIndex, element.start_epoch_ms, elevations[elevationIndex].start_epoch_ms, elevation)
        trkptTime.setTime(element.start_epoch_ms)
        output += `      <trkpt lat="${element.value}" lon="${longitudes[index].value}">\n        <ele>${elevation}</ele>\n        <time>${trkptTime.toISOString()}</time>\n      </trkpt>\n`
    })

    output += `    </trkseg>\n  </trk>\n</gpx>`
    return output
}

async function uploadToStrava(filename, activityname, id) {
    let fileFormData = new FormData()
    fileFormData.append('file', fs.createReadStream(`${outputPath}/${filename}.gpx`), {
        filename: `${filename}.gpx`
    })
    fileFormData.append('name', `${activityname}`)
    fileFormData.append('trainer', `false`)
    fileFormData.append('commute', `false`)
    fileFormData.append('data_type', `gpx`)
    fileFormData.append('external_id', `${id}`)

    const formHeaders = fileFormData.getHeaders()
    const stravaActivityUpload = await stravaAPIRequest.post('/uploads', fileFormData, {
        headers: {
            ...formHeaders,
        }
    })

    console.log(stravaActivityUpload)
    return stravaActivityUpload
}