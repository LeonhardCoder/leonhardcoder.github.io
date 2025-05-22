// story.js
/* ---------- imports externos ---------- */
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import * as i18nIsoCountries from "https://esm.sh/i18n-iso-countries@7.14.0";
import * as topojson from "https://cdn.jsdelivr.net/npm/topojson-client@3/+esm";
// 1. Cargar GeoJSON + CSVs


Promise.all([
  d3.json("https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json"),
  d3.csv("data/lost_revenue_by_country.csv", d3.autoType),
  d3.csv("data/cancel_rate_by_year.csv", d3.autoType),
  d3.csv("data/adr_by_country_hotel.csv", d3.autoType),
  d3.csv("data/daily_cancellations.csv", d3.autoType),
  d3.json("https://unpkg.com/i18n-iso-countries@7.14.0/langs/es.json"),
  d3.csv("data/lost_revenue_by_year_month.csv", d => {
    const monthMap = {
      enero: "01", febrero: "02", marzo: "03", abril: "04",
      mayo:  "05", junio:   "06", julio:  "07", agosto: "08",
      septiembre:"09", octubre:"10", noviembre:"11", diciembre:"12"
    };
    const m = monthMap[d.month.toLowerCase()];
    return {
      date:      d3.timeParse("%Y-%m")(`${d.year}-${m}`),
      year:      +d.year,
      month:     m,                             // ya en "07", "08", …
      cancelled: +d.bookings_cancelled,
      lost:      +d.lost_revenue
    };
  })
]).then(([world, lostRev, cancelYear, adrCountry, dailyCancels, esLocale, monthly]) => {

  i18nIsoCountries.registerLocale(esLocale);

  const features = topojson
    .feature(world, world.objects.countries)
    .features
    .map(f => {
      const numCode = String(f.id);
      const alpha3  = i18nIsoCountries.numericToAlpha3(numCode);
      f.properties.iso_a3 = alpha3;
      return f;
    });

  const controller = new ScrollMagic.Controller();

  setupMapScene(controller, features, lostRev);
  setupLineScene(controller, cancelYear);
  setupBarScene(controller, adrCountry);
  //setupTimeSeriesScene(controller, dailyCancels);
  setupMonthlyScene(controller, monthly);
});


// ─── Panel 1: Choropleth Map ───────────────────────────────
function setupMapScene(controller, countries, data) {
  new ScrollMagic.Scene({
    triggerElement: "#panel-map",
    triggerHook: 0.5
  })
  .on("enter", () => {
    d3.select("#story-title")
      .text("¿Cuánto se pierde y dónde?");
    d3.select("#story-description")
    .text("El mapa muestra las pérdidas económicas por cancelaciones de reservas.");
    d3.select("#chart-map").selectAll("*").remove();
    renderMap("#chart-map", countries, data);
  })
  .on("leave", () => {
    d3.select("#chart-map").selectAll("*").remove();
    d3.selectAll(".tooltip").remove();
  })
  .addTo(controller);
}

function renderMap(selector, countries, data) {
  const container = document.querySelector(selector);
  const width     = container.clientWidth;
  const height    = container.clientHeight;

  // Crear SVG
  const svg = d3.select(selector).append("svg")
    .attr("width",  width)
    .attr("height", height)
    .attr("role", "img")
    .attr("aria-label", "Mapa coroplético de ingresos perdidos por país");

  svg.append("title")
     .text("Ingresos perdidos por país");

  // Proyección y path
  const projection = d3.geoNaturalEarth1()
    .fitSize([width, height], { type: "FeatureCollection", features: countries });
  const path = d3.geoPath(projection);

  // Datos y escala de color
  const revByIso = new Map(data.map(d =>
    [d.country.toUpperCase(), d.lost_revenue]
  ));
  const values = data.map(d => d.lost_revenue);
  const color = d3.scaleQuantile()
    .domain(values)
    .range(d3.schemeOrRd[7]);

  // Tooltip
  const tooltip = d3.select("body").append("div")
    .attr("class", "tooltip")
    .style("opacity", 0)
    .style("position", "absolute")
    .style("background", "#fff")
    .style("border", "1px solid #ccc")
    .style("padding", "6px")
    .style("pointer-events", "none");

  // Dibujar países
  svg.selectAll("path")
    .data(countries)
    .join("path")
      .attr("d", path)
      .attr("fill", d => {
        const code = (d.properties.iso_a3 || "").toUpperCase();
        const v    = revByIso.get(code);
        return v != null ? color(v) : "#eeeeee";
      })
      .attr("stroke", "#999")
      .attr("opacity", 0)
      .on("mousemove", (event, d) => {
        const code = (d.properties.iso_a3 || "").toUpperCase();
        const v    = revByIso.get(code);
        tooltip.transition().duration(100).style("opacity", 0.95);
        tooltip.html(`
          <strong>${d.properties.name}</strong><br>
          Perdido: <b>${v != null
            ? d3.format("$,.0f")(v)
            : "Sin datos"}</b>`)
          .style("left", (event.pageX + 15) + "px")
          .style("top",  (event.pageY - 28) + "px");
      })
      .on("mouseleave", () =>
        tooltip.transition().duration(200).style("opacity", 0)
      )
      .transition().duration(800).attr("opacity", 1);

  // ─── Leyenda centrada y espaciada ─────────────────────────────
  const legendPadding = 20;
  const maxLegendWidth = width - legendPadding * 2;
  const cellCount      = color.range().length;
  const legendWidth    = Math.min(400, maxLegendWidth);
  const cellWidth      = legendWidth / cellCount;
  const legendX        = (width - legendWidth) / 2;
  const legendY        = height - 40;

  // contenedor de leyenda
  const legend = svg.append("g")
    .attr("transform", `translate(${legendX},${legendY})`);

  // rectángulos
  legend.selectAll("rect")
    .data(color.range())
    .join("rect")
      .attr("x",     (_, i) => i * cellWidth)
      .attr("y",     0)
      .attr("width", cellWidth)
      .attr("height", 12)
      .attr("fill",  d => d)
      .attr("stroke","#ccc");

  // valores de tick: [mínimo, cuantiles..., máximo]
  const quantiles = color.quantiles();
  const tickValues = [
    color.domain()[0],
    ...quantiles,
    color.domain()[1]
  ];
  const tickScale = d3.scaleLinear()
    .domain([0, tickValues.length - 1])
    .range([0, legendWidth]);

  // etiquetas bajo cada tick
  legend.selectAll("text.tick")
    .data(tickValues)
    .join("text")
      .attr("class", "tick")
      .attr("x", (_, i) => tickScale(i))
      .attr("y", 12 + 15)
      .attr("text-anchor", "middle")
      .attr("font-size", "0.8rem")
      .text(d => d3.format("$.2s")(d));

  // título centrado
  legend.append("text")
    .attr("x", legendWidth / 2)
    .attr("y", -8)
    .attr("text-anchor", "middle")
    .attr("font-size", "0.9rem")
    .text("Ingresos perdidos");
}



// ─── Panel 2: Cancellation Rate Line Chart ────────────────
function setupLineScene(controller, data) {
  new ScrollMagic.Scene({
    triggerElement: "#panel-line",
    triggerHook: 0.5
  })
  .on("enter", () => {
    d3.select("#story-title")
      .text("¿Cómo varía la tasa de cancelación por tipo de hotel?");
    d3.select("#story-description")
      .text("Comparativa agrupada de cancel_rate para City vs Resort en cada año.");
    d3.select("#chart-line").selectAll("*").remove();
    renderCancelRateBars("#chart-line", data);
  })
  .on("leave", () => {
    d3.select("#chart-line").selectAll("*").remove();
  })
  .addTo(controller);
}

function renderCancelRateBars(selector, data) {
  // 1. Conversión de datos: extraer años y hoteles únicos
  const years  = Array.from(new Set(data.map(d => d.year))).sort();
  const hotels = Array.from(new Set(data.map(d => d.hotel)));

  // 2. Márgenes y dimensiones
  const container = document.querySelector(selector);
  const margin    = { top: 20, right: 120, bottom: 40, left: 50 };
  const width     = container.clientWidth  - margin.left - margin.right;
  const height    = container.clientHeight - margin.top  - margin.bottom;

  // 3. Crear SVG
  const svg = d3.select(selector).append("svg")
      .attr("width",  width + margin.left + margin.right)
      .attr("height", height + margin.top  + margin.bottom)
    .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

  // 4. Escalas
  const x0 = d3.scaleBand()
      .domain(years)
      .range([0, width])
      .paddingInner(0.2);

  const x1 = d3.scaleBand()
      .domain(hotels)
      .range([0, x0.bandwidth()])
      .padding(0.1);

  const y = d3.scaleLinear()
      .domain([0, d3.max(data, d => d.cancel_rate)]).nice()
      .range([height, 0]);

  const color = d3.scaleOrdinal()
      .domain(hotels)
      .range(["#1f77b4", "#ff7f0e"]);

  // 5. Ejes
  svg.append("g")
      .attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(x0).tickFormat(d3.format("d")))
    .selectAll("text")
      .attr("font-size","0.9rem");

  svg.append("g")
      .call(d3.axisLeft(y).tickFormat(d3.format(".0%")))
    .append("text")
      .attr("transform","rotate(-90)")
      .attr("x",-height/2)
      .attr("y",-margin.left+15)
      .attr("fill","#000")
      .attr("text-anchor","middle")
      .attr("font-size","0.9rem")
      .text("Cancel Rate");

  // 6. Tooltip
  const tooltip = d3.select("body").append("div")
    .attr("class", "tooltip")
    .style("position",       "absolute")
    .style("background",     "rgba(255,255,255,0.9)")
    .style("border",         "1px solid #999")
    .style("padding",        "6px")
    .style("pointer-events", "none")
    .style("opacity",        0)
    .style("font-size",      "0.85rem");

  // 7. Dibujar barras agrupadas con eventos de tooltip
  const yearGroups = svg.selectAll("g.year-group")
    .data(years)
    .join("g")
      .attr("class","year-group")
      .attr("transform", d => `translate(${x0(d)},0)`);

  yearGroups.selectAll("rect")
    .data(year => hotels.map(h => {
      const rec = data.find(d => d.year === year && d.hotel === h);
      return {
        hotel:         h,
        year:          year,
        rate:          rec.cancel_rate,
        bookings:      rec.total_bookings,
        cancellations: rec.cancellations
      };
    }))
    .join("rect")
      .attr("x",      d => x1(d.hotel))
      .attr("y",      d => y(d.rate))
      .attr("width",  x1.bandwidth())
      .attr("height", d => height - y(d.rate))
      .attr("fill",   d => color(d.hotel))
      .on("mousemove", (event, d) => {
        tooltip.html(`
          <strong>${d.year} — ${d.hotel}</strong><br>
          Cancel rate: <b>${d3.format(".1%")(d.rate)}</b><br>
          Bookings: <b>${d3.format(",")(d.bookings)}</b><br>
          Cancellations: <b>${d3.format(",")(d.cancellations)}</b>
        `)
        .style("left", (event.pageX + 10) + "px")
        .style("top",  (event.pageY - 40) + "px")
        .transition().duration(100).style("opacity", 1);
      })
      .on("mouseout", () =>
        tooltip.transition().duration(200).style("opacity", 0)
      );

  // 8. Leyenda
  const legend = svg.append("g")
      .attr("transform", `translate(${width + 20}, 20)`);

  hotels.forEach((h, i) => {
    const g = legend.append("g")
      .attr("transform", `translate(0, ${i * 25})`);

    g.append("rect")
      .attr("width", 18).attr("height", 12)
      .attr("fill", color(h));

    g.append("text")
      .attr("x", 22).attr("y", 10)
      .attr("font-size","0.85rem")
      .text(h);
  });
}




// ─── Panel 3: ADR Bar Chart ────────────────────────────────
// ─── Setup Scene ─────────────────────────────────────────────
function setupBarScene(controller, data) {
  new ScrollMagic.Scene({
    triggerElement: "#panel-bar",
    triggerHook: 0.5
  })
  .on("enter", () => {
    d3.select("#story-title")
      .text("ADR y volumen de reservas por país");
    d3.select("#story-description")
      .text("Cada burbuja muestra el Average Daily Rate (ADR) en el eje X y el total de reservas en el tamaño, para City vs Resort Hotels.");  
    d3.select("#chart-bar").selectAll("*").remove();
    renderBubbleChart("#chart-bar", data);
  })
  .on("leave", () => {
    d3.select("#chart-bar").selectAll("*").remove();
  })
  .addTo(controller);
}

// ─── Render Bubble Chart ────────────────────────────────────
async function renderBubbleChart(selector, data) {
  // 0) Asegurarnos de tener el locale registrado
  // (i18nIsoCountries viene importado en story.js y ya registramos "es")
  
  // 1) Top-15 países por reservas
  const topCountries = Array.from(
    d3.rollup(data, v => d3.sum(v, d=>d.total_bookings), d=>d.country),
    ([country, sum]) => ({ country, sum })
  )
  .sort((a,b) => d3.descending(a.sum, b.sum))
  .slice(0,15)
  .map(d => d.country);

  const filtered = data.filter(d => topCountries.includes(d.country));

  // 2) Márgenes y dimensiones
  const container = document.querySelector(selector);
  const margin    = { top: 20, right: 140, bottom: 60, left: 140 };
  const width     = container.clientWidth  - margin.left - margin.right;
  const height    = container.clientHeight - margin.top  - margin.bottom;

  // 3) SVG
  const svg = d3.select(selector).append("svg")
      .attr("width",  width + margin.left + margin.right)
      .attr("height", height + margin.top  + margin.bottom)
    .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

  // 4) Escalas
  const x = d3.scaleLinear()
      .domain(d3.extent(filtered, d=>d.average_adr)).nice()
      .range([0, width]);

  const y = d3.scaleBand()
      .domain(topCountries)
      .range([0, height])
      .padding(0.3);

  const size = d3.scaleSqrt()
      .domain(d3.extent(filtered, d=>d.total_bookings))
      .range([4, 30]);

  const color = d3.scaleOrdinal()
      .domain(["City Hotel","Resort Hotel"])
      .range(["#1f77b4","#ff7f0e"]);

  // 5) Ejes
  svg.append("g")
    .attr("transform", `translate(0,${height})`)
    .call(d3.axisBottom(x).tickFormat(d3.format("$,.0f")))
    .append("text")
      .attr("x", width/2).attr("y", 40)
      .attr("fill","#000").attr("text-anchor","middle")
      .attr("font-size","0.9rem")
      .text("Tarifa Media Diaria (ADR)");

  svg.append("g")
    .call(
      d3.axisLeft(y)
        .tickFormat(code => i18nIsoCountries.getName(code, "es") || code)
    )
    .selectAll("text")
      .attr("font-size","0.85rem");

  // 6) Tooltip
  const tooltip = d3.select("body").append("div")
    .attr("class","tooltip")
    .style("position","absolute")
    .style("background","rgba(255,255,255,0.9)")
    .style("border","1px solid #999")
    .style("padding","6px")
    .style("pointer-events","none")
    .style("opacity",0)
    .style("font-size","0.85rem");

  // 7) Dibujar burbujas
  svg.selectAll("circle")
    .data(filtered)
    .join("circle")
      .attr("cx", d => x(d.average_adr))
      .attr("cy", d => y(d.country) + y.bandwidth()/2)
      .attr("r",  d => size(d.total_bookings))
      .attr("fill", d => color(d.hotel))
      .attr("opacity", 0.7)
      .on("mousemove", (event,d) => {
        tooltip.html(`
          <strong>${i18nIsoCountries.getName(d.country,"es")}</strong><br>
          Hotel: <b>${d.hotel}</b><br>
          ADR: <b>${d3.format("$,.2f")(d.average_adr)}</b><br>
          Reservas: <b>${d3.format(",")(d.total_bookings)}</b>
        `)
        .style("left", (event.pageX+10)+"px")
        .style("top",  (event.pageY-28)+"px")
        .transition().duration(50).style("opacity",1);
      })
      .on("mouseout", () =>
        tooltip.transition().duration(100).style("opacity",0)
      );

  // 8) Leyenda
  const legend = svg.append("g")
      .attr("transform", `translate(${width + 20}, 0)`);

  ["City Hotel","Resort Hotel"].forEach((h,i) => {
    const g = legend.append("g")
      .attr("transform", `translate(0, ${i*25})`);

    g.append("rect")
      .attr("width", 18).attr("height", 12)
      .attr("fill", color(h));

    g.append("text")
      .attr("x", 22).attr("y", 10)
      .attr("font-size","0.85rem")
      .text(h);
  });
}


// ─── Panel 4: Time Series with MA7 ─────────────────────────
function setupTimeSeriesScene(controller, data) {
  new ScrollMagic.Scene({
    triggerElement: "#panel-timeseries",
    triggerHook: 0.5
  })
  .on("enter", () => {
    d3.select("#story-title")
      .text("¿Cuándo cancelan? ");
    d3.select("#chart-timeseries").selectAll("*").remove();
    renderTimeSeries("#chart-timeseries", data);
  })
  .on("leave", () => {
    d3.select("#chart-timeseries").selectAll("*").remove();
  })
  .addTo(controller);
}

function renderTimeSeries(selector, data) {
  const d = data.sort((a,b) => d3.ascending(a.date, b.date));
  // calcular media móvil 7 días
  const ma7 = d3.rollups(d, v => d3.mean(v, d=>d.cancellations), d=>d.date)
                .map(([date, m]) => ({ date, ma7: m }))
                .slice(6);

  const container = document.querySelector(selector);
  const width  = container.clientWidth - 60;
  const height = container.clientHeight - 60;
  const svg = d3.select(selector).append("svg")
    .attr("width", width + 60)
    .attr("height", height + 60)
    .append("g")
      .attr("transform", "translate(50,20)");

  const x = d3.scaleTime()
    .domain(d3.extent(d, d=>d.date))
    .range([0, width]);
  const y = d3.scaleLinear()
    .domain([0, d3.max(d, d=>d.cancellations)])
    .range([height, 0]);

  svg.append("g")
    .attr("transform", `translate(0,${height})`)
    .call(d3.axisBottom(x).ticks(6));
  svg.append("g")
    .call(d3.axisLeft(y).tickFormat(d3.format(".0f")));

  // línea cruda
  svg.append("path")
    .datum(d)
    .attr("fill","none")
    .attr("stroke","#ccc")
    .attr("stroke-width",1)
    .attr("d", d3.line()
      .x(d=>x(d.date))
      .y(d=>y(d.cancellations))
    );

  // media móvil
  svg.append("path")
    .datum(ma7)
    .attr("fill","none")
    .attr("stroke","#D95F02")
    .attr("stroke-width",2)
    .attr("d", d3.line()
      .x(d=>x(d.date))
      .y(d=>y(d.ma7))
    );
}


// ─── Variables globales ───────────────────────────
let dsMaster = [];

// ─── Setup de la escena mensual ───────────────────
function setupMonthlyScene(controller, monthly) {
  // 1) Guardamos y ordenamos
  dsMaster = monthly
    .sort((a,b) => d3.ascending(a.date, b.date));

  // 2) Enlazamos filtros
  initMonthlyFilters();

  // 3) Creamos la escena ScrollMagic
  new ScrollMagic.Scene({
    triggerElement: "#panel-timeseries",
    triggerHook:    0.5
  })
  .on("enter", () => {
    d3.select("#story-title")
      .text("Cancelaciones y pérdidas por mes");
    d3.select("#story-description")
      .text("Barras: reservas canceladas. Línea: ingresos perdidos (€).");
    updateMonthlyChart();   // render inicial
  })
  .on("leave", () => {
    d3.select("#chart-timeseries").selectAll("*").remove();
  })
  .addTo(controller);
}

// ─── Inicializamos listeners en los <select> ───────
function initMonthlyFilters() {
  d3.select("#year-filter").on("change", updateMonthlyChart);
  d3.select("#month-filter").on("change", updateMonthlyChart);
}

// ─── Filtrar y redibujar ───────────────────────────
function updateMonthlyChart() {
  const yearSel  = d3.select("#year-filter").node().value;
  const monthSel = d3.select("#month-filter").node().value;

  let ds = dsMaster;
  if (yearSel  !== "all") ds = ds.filter(d => d.year.toString() === yearSel);
  if (monthSel !== "all") ds = ds.filter(d => d.month === monthSel);

  d3.select("#chart-timeseries").selectAll("*").remove();
  renderMonthlyCombo("#chart-timeseries", ds);
}

// ─── Combo chart (no modificar) ────────────────────
function renderMonthlyCombo(selector, ds) {
  const container = document.querySelector(selector);
  const margin    = { top:20, right:60, bottom:40, left:50 };
  const width     = container.clientWidth  - margin.left - margin.right;
  const height    = container.clientHeight - margin.top  - margin.bottom;

  const svg = d3.select(selector).append("svg")
      .attr("width",  width + margin.left + margin.right)
      .attr("height", height + margin.top  + margin.bottom)
    .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

  // Escalas
  const x  = d3.scaleTime()
    .domain(d3.extent(ds, d => d.date)).range([0, width]);
  const y0 = d3.scaleLinear()
    .domain([0, d3.max(ds, d => d.cancelled)]).nice()
    .range([height, 0]);
  const y1 = d3.scaleLinear()
    .domain([0, d3.max(ds, d => d.lost)]).nice()
    .range([height, 0]);

  // Ejes
  svg.append("g")
      .attr("transform", `translate(0,${height})`)
      .call(d3.axisBottom(x)
         .ticks(d3.timeMonth.every(1))
         .tickFormat(d3.timeFormat("%b %Y")))
    .selectAll("text")
      .attr("text-anchor","end")
      .attr("transform","rotate(-45)")
      .attr("font-size","0.8rem");

  svg.append("g")
      .call(d3.axisLeft(y0).ticks(5).tickFormat(d3.format(",")))
    .append("text")
      .attr("fill","#000")
      .attr("x",-margin.left)
      .attr("y",-10)
      .attr("text-anchor","start")
      .attr("font-size","0.85rem")
      .text("Reservas canceladas");

  svg.append("g")
      .attr("transform", `translate(${width},0)`)
      .call(d3.axisRight(y1).ticks(5).tickFormat(d3.format("$.2s")))
    .append("text")
      .attr("fill","#000")
      .attr("x",0)
      .attr("y",-10)
      .attr("text-anchor","end")
      .attr("font-size","0.85rem")
      .text("Ingresos perdidos (€)");

  // Tooltip
  const tooltip = d3.select("body").append("div")
    .attr("class","tooltip")
    .style("position","absolute")
    .style("background","rgba(255,255,255,0.9)")
    .style("border","1px solid #999")
    .style("padding","6px")
    .style("pointer-events","none")
    .style("opacity",0)
    .style("font-size","0.85rem");

  // Barras (cancelled)
  svg.selectAll("rect")
    .data(ds)
    .join("rect")
      .attr("x",      d => x(d.date) - (width/ds.length)/2 )
      .attr("y",      d => y0(d.cancelled) )
      .attr("width",  (width/ds.length)*0.9 )
      .attr("height", d => height - y0(d.cancelled) )
      .attr("fill",   "#69b3a2")
      .on("mouseenter", (e,d) => {
        tooltip.html(`Cancelaciones: <b>${d.cancelled}</b>`)
               .style("left", e.pageX+5+"px")
               .style("top",  e.pageY-30+"px")
               .transition().duration(50).style("opacity",1);
      })
      .on("mouseleave", () =>
        tooltip.transition().duration(100).style("opacity",0)
      );

  // Línea (lost)
  const line = d3.line()
    .x(d => x(d.date))
    .y(d => y1(d.lost))
    .curve(d3.curveMonotoneX);

  svg.append("path")
      .datum(ds)
      .attr("fill","none")
      .attr("stroke","#ff7f0e")
      .attr("stroke-width",2.5)
      .attr("d", line);
}