import type {HelpCountriesList} from '@layer';

// The bundled country list only formats phone numbers and names countries: shared contacts,
// fact checks, poll country restrictions, profiles and phone sign-in, all left out of the
// widget. A managed customer signs in by token. Unformatted numbers stay as they were sent.
const Countries: HelpCountriesList.helpCountriesList = {_: 'help.countriesList', countries: [], hash: 0};
export default Countries;
