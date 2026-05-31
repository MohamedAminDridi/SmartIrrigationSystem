const axios = require('axios');
const BASE  = 'https://api.open-meteo.com/v1/forecast';

exports.getForecast = async (lat, lng, days=1) => {
  const { data } = await axios.get(BASE, {
    params: {
      latitude:lat, longitude:lng, forecast_days:days,
      hourly:['temperature_2m','relative_humidity_2m',
              'precipitation_probability','precipitation',
              'et0_fao_evapotranspiration'].join(','),
      timezone:'auto',
    },
    timeout: 8000,
  });
  return data;
};
