function r(l,e){const{nw_lat:n,nw_lng:o,se_lat:a,se_lng:g}=e;return l.map(t=>({lat:n+(a-n)*t.y,lng:o+(g-o)*t.x}))}export{r as projectPolygonToGeo};
