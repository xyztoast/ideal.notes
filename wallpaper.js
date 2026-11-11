(() => {
  const canvas = document.getElementById('wallpaper');
  if (!canvas) return;

  const vertexSource = `
    attribute vec2 a_position;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const fragmentSource = `
    precision mediump float;
    uniform vec2 u_resolution;
    uniform float u_time;
    uniform vec2 u_pointer;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    float glowBlob(vec2 p, vec2 center, vec2 scale, float rotation) {
      float c = cos(rotation);
      float s = sin(rotation);
      vec2 q = p - center;
      q = mat2(c, -s, s, c) * q;
      q /= scale;
      return exp(-dot(q, q) * 1.65);
    }

    void main() {
      vec2 uv = gl_FragCoord.xy / u_resolution.xy;
      float aspect = u_resolution.x / u_resolution.y;
      vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
      p += u_pointer * 0.025;
      float t = u_time * 0.075;

      vec3 color = vec3(0.075, 0.12, 0.19);
      float atmosphere = smoothstep(-0.48, 0.62, p.y + 0.11 * sin(p.x * 2.0 + t));
      color += vec3(0.045, 0.085, 0.135) * atmosphere;

      vec2 c1 = vec2(0.36 * sin(t * 0.72), 0.22 * cos(t * 0.61) + 0.13);
      vec2 c2 = vec2(-0.42 * cos(t * 0.58), -0.18 * sin(t * 0.76) - 0.06);
      vec2 c3 = vec2(0.13 + 0.23 * sin(t * 0.42 + 1.6), -0.36 * cos(t * 0.54));
      vec2 c4 = vec2(-0.16 * sin(t * 0.46 + 2.0), 0.44 * sin(t * 0.35));

      float b1 = glowBlob(p, c1, vec2(0.56, 0.31), 0.38 + 0.14 * sin(t));
      float b2 = glowBlob(p, c2, vec2(0.54, 0.39), -0.52 + 0.12 * cos(t * 0.8));
      float b3 = glowBlob(p, c3, vec2(0.38, 0.54), 0.82);
      float b4 = glowBlob(p, c4, vec2(0.72, 0.21), -0.24);
      color += vec3(0.085, 0.19, 0.31) * b1;
      color += vec3(0.09, 0.22, 0.35) * b2;
      color += vec3(0.13, 0.25, 0.38) * b3;
      color += vec3(0.10, 0.19, 0.31) * b4;

      float waveA = 0.17 * sin(p.x * 2.15 + t * 1.2) + 0.055 * sin(p.x * 4.1 - t * 0.8);
      float waveB = -0.20 + 0.11 * sin(p.x * 1.72 - t * 0.9 + 1.3);
      float ribbonA = exp(-pow((p.y - waveA) * 5.2, 2.0));
      float ribbonB = exp(-pow((p.y - waveB) * 4.0, 2.0));
      float edgeLight = exp(-pow((p.y - (waveA + 0.12)) * 14.0, 2.0));
      color += vec3(0.10, 0.20, 0.31) * ribbonA * 0.32;
      color += vec3(0.08, 0.16, 0.27) * ribbonB * 0.25;
      color += vec3(0.16, 0.28, 0.40) * edgeLight * 0.12;

      float upperGlow = glowBlob(p, vec2(-0.23, 0.58), vec2(0.92, 0.16), -0.13);
      float lowerGlow = glowBlob(p, vec2(0.18, -0.69), vec2(0.84, 0.18), 0.1);
      color += vec3(0.11, 0.18, 0.27) * (upperGlow + lowerGlow) * 0.48;

      float vignette = 1.0 - smoothstep(0.36, 1.08, length(p * vec2(0.86, 0.92)));
      color *= 0.84 + vignette * 0.16;
      float grain = (hash(gl_FragCoord.xy + floor(u_time * 2.0)) - 0.5) * 0.012;
      color += grain;
      color = pow(max(color, 0.0), vec3(0.92));
      gl_FragColor = vec4(color, 1.0);
    }
  `;

  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power'
  });

  if (!gl) {
    canvas.classList.add('wallpaper-fallback');
    return;
  }

  function compileShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.warn('Wallpaper shader could not be compiled:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  const vertexShader = compileShader(gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertexShader || !fragmentShader) {
    canvas.classList.add('wallpaper-fallback');
    return;
  }

  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('Wallpaper program could not be linked:', gl.getProgramInfoLog(program));
    canvas.classList.add('wallpaper-fallback');
    return;
  }

  gl.useProgram(program);
  const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'a_position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const resolutionLocation = gl.getUniformLocation(program, 'u_resolution');
  const timeLocation = gl.getUniformLocation(program, 'u_time');
  const pointerLocation = gl.getUniformLocation(program, 'u_pointer');
  let pointer = [0, 0];
  let pointerTarget = [0, 0];
  let lastFrame = 0;
  let startTime = performance.now();
  let frameId = null;
  let isVisible = !document.hidden;

  function resize() {
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.max(1, Math.floor(window.innerWidth * ratio));
    const height = Math.max(1, Math.floor(window.innerHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
      gl.uniform2f(resolutionLocation, width, height);
    }
  }

  function render(now) {
    if (!isVisible) return;
    if (now - lastFrame < 28) {
      frameId = requestAnimationFrame(render);
      return;
    }
    lastFrame = now;
    pointer[0] += (pointerTarget[0] - pointer[0]) * 0.018;
    pointer[1] += (pointerTarget[1] - pointer[1]) * 0.018;
    gl.uniform1f(timeLocation, (now - startTime) / 1000);
    gl.uniform2f(pointerLocation, pointer[0], pointer[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    frameId = requestAnimationFrame(render);
  }

  window.addEventListener('resize', resize, { passive: true });
  window.addEventListener('pointermove', event => {
    pointerTarget[0] = (event.clientX / Math.max(1, window.innerWidth) - 0.5) * 2;
    pointerTarget[1] = (0.5 - event.clientY / Math.max(1, window.innerHeight)) * 2;
  }, { passive: true });
  document.addEventListener('visibilitychange', () => {
    isVisible = !document.hidden;
    if (isVisible && frameId === null) {
      startTime = performance.now();
      frameId = requestAnimationFrame(render);
    } else if (!isVisible && frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
  });

  resize();
  frameId = requestAnimationFrame(render);
})();
