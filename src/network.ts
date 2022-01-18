require('isomorphic-fetch');

/**
 * what to do if fetch() generated an error
 * @param response returned from the fetch() call
 */
const dealWithFetchError = (response: Response) => {
  throw new Error(JSON.stringify(response));
};

/**
 * check the response type and return it
 * @param response returned from the fetch() call
 */
const getDataFromResponse = async (response: Response) => {
  const isJson = response.headers
    .get('content-type')
    ?.includes('application/json');
  return isJson ? await response.json() : await response.text();
};

/**
 * get data from a given url using fetch()
 * @param url url for the webservice
 */
export const getWithFetch = async (url: string) => {
  const response = await fetch(url, {
    method: 'GET',
    mode: 'cors',
  });
  if (response.status !== 200) dealWithFetchError(response);
  const data = await getDataFromResponse(response);
  return data;
};
