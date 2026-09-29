# Earth imagery — sources & licence

The Earth textures in this folder are **NASA Blue Marble** imagery, obtained from
the [three.js examples repository](https://github.com/mrdoob/three.js/tree/dev/examples/textures/planets)
(`examples/textures/planets/`), which redistributes them unmodified.

| File here | Original | NASA source |
|---|---|---|
| `earth_day.jpg` | `earth_atmos_2048.jpg` | [Blue Marble: land surface, shallow water and shaded topography](https://visibleearth.nasa.gov/images/57752/the-blue-marble-land-surface-shallow-water-and-shaded-topography) |
| `earth_clouds.png` | `earth_clouds_1024.png` | [Blue Marble: clouds](https://visibleearth.nasa.gov/images/57747/blue-marble-clouds) |
| `earth_night.jpg` | `earth_lights_2048.png` | NASA Earth at Night |
| `earth_normal.jpg` | `earth_normal_2048.jpg` | derived topography/bump |
| `earth_specular.jpg` | `earth_specular_2048.jpg` | land/ocean mask (ocean = reflective) |

**Licence.** NASA content is generally **not copyrighted** and may be used freely;
see the [NASA Media Usage Guidelines](https://www.nasa.gov/nasa-brand-center/images-and-media/)
and the [NASA Visible Earth](https://visibleearth.nasa.gov/) terms. Credit to
NASA/GSFC is appreciated rather than required. The three.js repository itself is
MIT licensed.

Modifications made here: re-encoded to JPEG/PNG for web delivery, and the cloud
map converted from palette-with-transparency to RGBA. No pixel data was altered.
