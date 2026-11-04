/**
 * Ignite Reveal для фото организатора.
 *
 * Снизу лежит ч/б снимок, поверх — canvas с цветным. По скроллу огненная
 * кромка «прожигает» цвет слева-снизу вправо-вверх; при наведении процесс
 * идёт назад, после ухода мыши — снова к цвету.
 *
 * Если WebGL недоступен или включён prefers-reduced-motion, остаётся
 * статичная пара фото: ч/б и цветное (простое переключение без огня).
 */
(() => {
  'use strict';

  const items = Array.from(document.querySelectorAll('[data-ignite]'));
  if (!items.length) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  if (reduceMotion) {
    items.forEach((el) => el.classList.add('is-static'));
    return;
  }

  const VERTEX_SHADER = `
    attribute vec2 a_position;
    varying vec2 v_uv;

    void main() {
      v_uv = a_position * 0.5 + 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const FRAGMENT_SHADER = `
    precision highp float;

    varying vec2 v_uv;
    uniform sampler2D u_texture;
    uniform sampler2D u_noise;
    uniform float u_progress;
    uniform float u_time;

    float noiseAt(vec2 p) {
      return texture2D(u_noise, p).r;
    }

    void main() {
      vec2 uv = v_uv;

      // Радиальный фронт: цвет проявляется из центра во все стороны.
      float radius = length(uv - 0.5) * 1.4142;
      float field = radius
        + (noiseAt(uv * 1.8 + 0.13) - 0.5) * 0.22
        + (noiseAt(uv * 4.6 + 0.71) - 0.5) * 0.07;

      float front = mix(-0.22, 1.36, u_progress);
      float delta = field - front;

      float mask = 1.0 - smoothstep(front - 0.02, front + 0.02, field);

      float flame = exp(-delta * delta / 0.0038);
      flame *= 0.82 + 0.18 * noiseAt(uv * 4.0 + vec2(u_time * 0.015, 0.0));

      float charDelta = (delta - 0.085) / 0.07;
      float char = exp(-charDelta * charDelta) * (1.0 - mask);
      char *= 0.7 + 0.3 * noiseAt(uv * 7.0 + 0.2);

      // Тепловое искажение у кромки.
      vec2 warp = vec2(
        noiseAt(uv * 4.0 + vec2(0.0, u_time * 0.012)),
        noiseAt(uv * 4.0 + vec2(0.37, 0.11 - u_time * 0.012))
      ) - 0.5;
      vec2 warpedUv = uv + warp * 0.022 * flame;

      vec3 color = texture2D(u_texture, warpedUv).rgb;
      vec3 flameColor = mix(
        vec3(1.0, 0.20, 0.02),
        vec3(1.0, 0.78, 0.30),
        smoothstep(0.0, 0.8, flame)
      );

      color = mix(color * 0.55, color, mask);
      color = mix(color, color * 0.12, char * 0.9);
      color += flameColor * flame * 0.95;
      color += vec3(1.0, 0.92, 0.72) * pow(flame, 18.0) * 0.35;

      float alpha = clamp(max(mask, max(flame * 0.85, char * 0.55)), 0.0, 1.0);
      gl_FragColor = vec4(color, alpha);
    }
  `;

  function compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    if (!shader) return null;

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }

    return shader;
  }

  function createProgram(gl) {
    const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);

    if (!vertex || !fragment) {
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
      return null;
    }

    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      return null;
    }

    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return null;
    }

    return program;
  }

  const NOISE_SIZE = 256;
  let noiseData = null;

  function getNoiseData() {
    if (noiseData) return noiseData;

    let seed = 0x9e3779b9;

    function random() {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) / 4294967296;
    }

    const octaves = [];
    let frequency = 4;

    for (let octave = 0; octave < 4; octave++) {
      const grid = new Float32Array(frequency * frequency);
      for (let i = 0; i < grid.length; i++) grid[i] = random();
      octaves.push({ frequency, grid });
      frequency *= 2;
    }

    const data = new Uint8Array(NOISE_SIZE * NOISE_SIZE * 4);

    for (let y = 0; y < NOISE_SIZE; y++) {
      for (let x = 0; x < NOISE_SIZE; x++) {
        let value = 0;
        let amplitude = 0.5;

        for (const { frequency: freq, grid } of octaves) {
          const fx = (x / NOISE_SIZE) * freq;
          const fy = (y / NOISE_SIZE) * freq;
          const x0 = Math.floor(fx);
          const y0 = Math.floor(fy);
          const tx = fx - x0;
          const ty = fy - y0;
          const sx = tx * tx * (3 - 2 * tx);
          const sy = ty * ty * (3 - 2 * ty);
          const x1 = (x0 + 1) % freq;
          const y1 = (y0 + 1) % freq;
          const a = grid[y0 * freq + x0];
          const b = grid[y0 * freq + x1];
          const c = grid[y1 * freq + x0];
          const d = grid[y1 * freq + x1];
          const top = a + (b - a) * sx;
          const bottom = c + (d - c) * sx;

          value += amplitude * (top + (bottom - top) * sy);
          amplitude *= 0.5;
        }

        value = Math.max(0, Math.min(1, value / 0.9375));

        const byte = Math.round(value * 255);
        const index = (y * NOISE_SIZE + x) * 4;

        data[index] = byte;
        data[index + 1] = byte;
        data[index + 2] = byte;
        data[index + 3] = 255;
      }
    }

    noiseData = data;
    return data;
  }

  function setup(el) {
    const colorImage = el.querySelector('.ignite__color');
    const canvas = el.querySelector('.ignite__canvas');

    if (!colorImage || !canvas) return;

    let gl = null;
    try {
      gl = canvas.getContext('webgl', {
        alpha: true,
        premultipliedAlpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        powerPreference: 'low-power',
      }) || canvas.getContext('experimental-webgl');
    } catch (error) {
      gl = null;
    }

    if (!gl) {
      el.classList.add('is-fallback');
      return;
    }

    const program = createProgram(gl);
    if (!program) {
      el.classList.add('is-fallback');
      return;
    }

    gl.useProgram(program);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW
    );

    const positionLocation = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);
    gl.uniform1i(gl.getUniformLocation(program, 'u_noise'), 1);

    // Готовая шумовая текстура: кромка получается гладкой, без «квадратов».
    const noiseTexture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, noiseTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      NOISE_SIZE,
      NOISE_SIZE,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      getNoiseData()
    );
    gl.activeTexture(gl.TEXTURE0);

    const progressLocation = gl.getUniformLocation(program, 'u_progress');
    const timeLocation = gl.getUniformLocation(program, 'u_time');

    let progress = 0;
    let revealed = false;
    let ready = false;
    let raf = 0;
    let lastTime = 0;
    let observer = null;

    function resize() {
      if (!ready) return;

      const rect = el.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        gl.viewport(0, 0, width, height);
        draw(lastTime);
      }
    }

    function draw(now) {
      if (!ready) return;

      lastTime = now;
      gl.useProgram(program);
      gl.uniform1f(progressLocation, progress);
      gl.uniform1f(timeLocation, (now * 0.001) % 1000);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    function tweenTo(target, duration) {
      const from = progress;
      if (Math.abs(target - from) < 0.001) return;

      const start = performance.now();
      cancelAnimationFrame(raf);

      function step(now) {
        const t = Math.min(1, (now - start) / duration);
        const eased = 0.5 - 0.5 * Math.cos(Math.PI * t);

        progress = from + (target - from) * eased;
        draw(now);

        if (t < 1) raf = requestAnimationFrame(step);
      }

      raf = requestAnimationFrame(step);
    }

    function revealOnScroll() {
      if (revealed) return;
      revealed = true;
      tweenTo(1, 2400);
    }

    function observe() {
      if ('IntersectionObserver' in window) {
        observer = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting) revealOnScroll();
            });
          },
          { threshold: 0.4 }
        );
        observer.observe(el);
      } else {
        revealOnScroll();
      }
    }

    function onLoad() {
      try {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          colorImage
        );
      } catch (error) {
        el.classList.add('is-fallback');
        return;
      }

      ready = true;
      el.classList.add('is-ready');
      resize();
      draw(performance.now());
      observe();
    }

    if (colorImage.complete && colorImage.naturalWidth) {
      onLoad();
    } else {
      colorImage.addEventListener('load', onLoad, { once: true });
      colorImage.addEventListener(
        'error',
        () => el.classList.add('is-fallback'),
        { once: true }
      );
    }

    if ('ResizeObserver' in window) {
      new ResizeObserver(resize).observe(el);
    } else {
      window.addEventListener('resize', resize, { passive: true });
    }

    if (canHover) {
      el.addEventListener('pointerenter', () => {
        if (revealed) tweenTo(0, 1400);
      });

      el.addEventListener('pointerleave', () => {
        if (revealed) tweenTo(1, 1800);
      });
    }

    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      cancelAnimationFrame(raf);
      el.classList.remove('is-ready');
      el.classList.add('is-fallback');
    });
  }

  items.forEach(setup);
})();
