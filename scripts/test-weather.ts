import { getWeather, getWeatherBrief, getWeatherNextHours } from '../src/main/weather'

async function main() {
  const city = '天津市东丽区'
  console.log('=== getWeather ===')
  const w = await getWeather(city)
  console.log(JSON.stringify(w, null, 2))

  console.log('\n=== getWeatherBrief ===')
  const b = await getWeatherBrief(city)
  console.log(JSON.stringify(b, null, 2))

  console.log('\n=== getWeatherNextHours(3) ===')
  const h = await getWeatherNextHours(city, 3)
  console.log(JSON.stringify(h, null, 2))
}

main()