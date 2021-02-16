// This file can be replaced during build by using the `fileReplacements` array.
// `ng build ---prod` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

// const devUrl = 'npl-tools-api-dev.genmapper.com/api/';
const localUrl = 'https://localhost:7001/api/';
// const localUrl = devUrl;

export const environment = {
    production: false,
    apiKey: 'AIzaSyCzMNmQPVY9uivoKSzoj0ACwKr-LxxcHko',
    apiBase: localUrl,
    authConfig: {
        authority: 'https://idp-qa.taethni.com',
        clientId: 'angular_spa_local',
        responseType: 'code',
        scope: 'profile openid IdentityServerApi web_api roles offline_access',
        logLevel: 'Debug',
        useSessionStore: true
    }
};

/*
 * In development mode, to ignore zone related error stack frames such as
 * `zone.run`, `zoneDelegate.invokeTask` for easier debugging, you can
 * import the following file, but please comment it out in production mode
 * because it will have performance impact when throw error
 */
// import 'zone.js/dist/zone-error';  // Included with Angular CLI.
