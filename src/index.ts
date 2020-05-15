import Renderer from './Renderer';
import Shader from './Shader';
import ShaderProgram from './ShaderProgram';
import { mat4, vec3, glMatrix, quat } from 'gl-matrix';
import InteractionCamera from './InteractionCamera';
import { Mesh, OBJ } from 'webgl-obj-loader';
import MRTTexture from './MRTTexture';

import goddessData from './models/goddess.obj';
import fighterData from './models/fighter.obj';
import particleData from './models/particle.obj';

import particleMoveVertStr from './shaders/particleMove.vert';
import particleMoveFragStr from './shaders/particleMove.frag';
import particleVertStr from './shaders/particle.vert';
import particleFragStr from './shaders/particle.frag';
import geometryVertStr from './shaders/geometry.vert';
import geometryFragStr from './shaders/geometry.frag';
import rectVertStr from './shaders/rect.vert';
import outputFragStr from './shaders/output.frag';
import raymarchingFragStr from './shaders/raymarching.frag';

window.addEventListener('DOMContentLoaded', (): void => {
  const gl = Renderer.gl;

  const camera = new InteractionCamera(10.0);

  // goddess
  const goddess = new Mesh(goddessData, { calcTangentsAndBitangents: true });
  const goddessBuffer = OBJ.initMeshBuffers(gl, goddess);

  // fighter
  const fighter = new Mesh(fighterData, { calcTangentsAndBitangents: true });
  const fighterBuffer = OBJ.initMeshBuffers(gl, fighter);

  // particle
  const particle = new Mesh(particleData, { calcTangentsAndBitangents: true });
  const particleBuffer = OBJ.initMeshBuffers(gl, particle);

  // G-Buffer
  const gBufTex = [
    new MRTTexture(Renderer.canvas.width, Renderer.canvas.height, 3, gl.FLOAT),
    new MRTTexture(Renderer.canvas.width, Renderer.canvas.height, 3, gl.FLOAT),
  ];
  for (let gi = 0; gi < gBufTex.length; gi++) {
    for (let gj = 0; gj < gBufTex[gi].texture2d.length; gj++) {
      gBufTex[gi].texture2d[gj].setFilter(gl.NEAREST, gl.NEAREST);
    }
  }
  let readBufferIdx = 0;
  let writeBufferIdx = 1;
  const swapGBuffer = (): void => {
    readBufferIdx = (readBufferIdx + 1) % 2;
    writeBufferIdx = (writeBufferIdx + 1) % 2;
  };

  // Particle transform feedback
  const particleMoveVert = new Shader(particleMoveVertStr, gl.VERTEX_SHADER);
  const particleMoveFrag = new Shader(particleMoveFragStr, gl.FRAGMENT_SHADER);
  const particleMoveProg = new ShaderProgram();
  gl.transformFeedbackVaryings(
    particleMoveProg.program,
    ['outPosition', 'outVelocity'],
    gl.SEPARATE_ATTRIBS
  );
  particleMoveProg.link(particleMoveVert, particleMoveFrag);
  const particleMoveTF = gl.createTransformFeedback();

  // Geometry
  const geometryVert = new Shader(geometryVertStr, gl.VERTEX_SHADER);
  const geometryFrag = new Shader(geometryFragStr, gl.FRAGMENT_SHADER);
  const geometryProg = new ShaderProgram();
  geometryProg.link(geometryVert, geometryFrag);

  // Particle
  const particleVert = new Shader(particleVertStr, gl.VERTEX_SHADER);
  const particleFrag = new Shader(particleFragStr, gl.FRAGMENT_SHADER);
  const particleProg = new ShaderProgram();
  particleProg.link(particleVert, particleFrag);

  // Raymarching
  const rectVert = new Shader(rectVertStr, gl.VERTEX_SHADER);
  const raymarchingFrag = new Shader(raymarchingFragStr, gl.FRAGMENT_SHADER);
  const raymarchingProg = new ShaderProgram();
  raymarchingProg.link(rectVert, raymarchingFrag);

  // Output
  const outputFrag = new Shader(outputFragStr, gl.FRAGMENT_SHADER);
  const outputProg = new ShaderProgram();
  outputProg.link(rectVert, outputFrag);

  gl.clearColor(0.0, 0.0, 0.0, 0.0);
  gl.clearDepth(1.0);

  // clear Read G-Buffer
  gBufTex[readBufferIdx].bind();
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gBufTex[readBufferIdx].unBind();

  let mMatrix = mat4.identity(mat4.create());
  let vMatrix = mat4.identity(mat4.create());
  let pMatrix = mat4.identity(mat4.create());
  let vpMatrix = mat4.identity(mat4.create());
  let mvpMatrix = mat4.identity(mat4.create());

  // Particle VBO for transform feedback
  const particleNum = 100000;
  const particlePos = new Float32Array(particleNum * 3);
  const particleVel = new Float32Array(particleNum * 3);
  for (let vi = 0; vi < particleNum; vi += 3) {
    particlePos[vi + 0] = 0.03 * Math.random() - 0.015;
    particlePos[vi + 1] = 0.5 * Math.random() - 0.25;
    particlePos[vi + 2] = 0.03 * Math.random() - 0.015;

    particleVel[vi + 0] = 0.0;
    particleVel[vi + 1] = 0.1;
    particleVel[vi + 2] = 0.0;
  }
  let particlePosRVBO = ShaderProgram.createVBO(particlePos, gl.DYNAMIC_COPY);
  let particlePosWVBO = ShaderProgram.createVBO(
    new Float32Array(particlePos.length),
    gl.DYNAMIC_COPY
  );
  let particleVelRVBO = ShaderProgram.createVBO(particleVel, gl.DYNAMIC_COPY);
  let particleVelWVBO = ShaderProgram.createVBO(
    new Float32Array(particleVel.length),
    gl.DYNAMIC_COPY
  );
  const swapParticleVBO = (): void => {
    const tmpP = particlePosRVBO;
    const tmpV = particleVelRVBO;
    particlePosRVBO = particlePosWVBO;
    particleVelRVBO = particleVelWVBO;
    particlePosWVBO = tmpP;
    particleVelWVBO = tmpV;
  };

  // main loop ========================================
  const zero = Date.now();
  let previousTime = performance.now();
  // let frameCount = 0;
  const tick = (): void => {
    requestAnimationFrame(tick);

    const time = (Date.now() - zero) * 1e-3 - 1.0;
    const currentTime = performance.now();
    const deltaTime = Math.min(0.1, (currentTime - previousTime) * 0.001);
    previousTime = currentTime;
    // const deltaTime = Math.min(0.01, time - prevTime);
    // prevTime = time;

    // camera update
    const fov = glMatrix.toRadian(60);
    camera.position = vec3.fromValues(0.0, -0.04, 0.0);
    camera.center = vec3.fromValues(0.0, 0.0, 1.0);
    // camera.update();
    mat4.lookAt(vMatrix, camera.position, camera.center, camera.up);
    mat4.perspective(
      pMatrix,
      fov,
      Renderer.canvas.width / Renderer.canvas.height,
      0.001,
      100
    );
    mat4.multiply(vpMatrix, pMatrix, vMatrix);

    // Particle transform feedback
    particleMoveProg.use();
    particleMoveProg.setAttribute(particlePosRVBO, 'position', 3, gl.FLOAT);
    particleMoveProg.setAttribute(particleVelRVBO, 'velocity', 3, gl.FLOAT);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, particleMoveTF);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, particlePosWVBO);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 1, particleVelWVBO);
    particleMoveProg.send1f('deltaTime', deltaTime);
    gl.enable(gl.RASTERIZER_DISCARD);
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, particleNum);
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.endTransformFeedback();
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null);
    gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 1, null);
    swapParticleVBO();

    // Rendering
    // Geometry rendering
    gBufTex[writeBufferIdx].bind();
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gBufTex[writeBufferIdx].setViewport();
    geometryProg.use();

    // goddess
    mat4.identity(mMatrix);
    let trs = mat4.create();
    mat4.fromRotationTranslationScale(
      trs,
      quat.fromEuler(quat.create(), 0.0, 210, 0.0),
      vec3.fromValues(0.02, -0.16, 0.2),
      vec3.fromValues(0.17, 0.17, 0.17)
    );
    mat4.multiply(mMatrix, mMatrix, trs);
    mat4.multiply(mvpMatrix, vpMatrix, mMatrix);

    geometryProg.sendMatrix4f('mMatrix', mMatrix);
    geometryProg.sendMatrix4f('mvpMatrix', mvpMatrix);
    geometryProg.setAttribute(
      goddessBuffer.vertexBuffer,
      'position',
      goddessBuffer.vertexBuffer.itemSize,
      gl.FLOAT
    );
    geometryProg.setAttribute(
      goddessBuffer.normalBuffer,
      'normal',
      goddessBuffer.normalBuffer.itemSize,
      gl.FLOAT
    );
    geometryProg.setAttribute(
      goddessBuffer.textureBuffer,
      'texcoord',
      goddessBuffer.textureBuffer.itemSize,
      gl.FLOAT
    );
    geometryProg.setIBO(goddessBuffer.indexBuffer);
    gl.drawElements(
      gl.TRIANGLES,
      goddessBuffer.indexBuffer.numItems,
      gl.UNSIGNED_SHORT,
      0
    );

    // fighter
    mat4.identity(mMatrix);
    mat4.fromRotationTranslationScale(
      trs,
      quat.fromEuler(quat.create(), 20, 210, 0.0),
      vec3.fromValues(-0.02, -0.03, 0.16),
      vec3.fromValues(0.005, 0.005, 0.005)
    );
    mat4.multiply(mMatrix, mMatrix, trs);
    mat4.multiply(mvpMatrix, vpMatrix, mMatrix);

    geometryProg.sendMatrix4f('mMatrix', mMatrix);
    geometryProg.sendMatrix4f('mvpMatrix', mvpMatrix);
    geometryProg.setAttribute(
      fighterBuffer.vertexBuffer,
      'position',
      fighterBuffer.vertexBuffer.itemSize,
      gl.FLOAT
    );
    geometryProg.setAttribute(
      fighterBuffer.normalBuffer,
      'normal',
      fighterBuffer.normalBuffer.itemSize,
      gl.FLOAT
    );
    geometryProg.setAttribute(
      fighterBuffer.textureBuffer,
      'texcoord',
      fighterBuffer.textureBuffer.itemSize,
      gl.FLOAT
    );
    geometryProg.setIBO(fighterBuffer.indexBuffer);
    gl.drawElements(
      gl.TRIANGLES,
      fighterBuffer.indexBuffer.numItems,
      gl.UNSIGNED_SHORT,
      0
    );

    // particle
    mat4.identity(mMatrix);
    mat4.fromRotationTranslationScale(
      trs,
      quat.fromEuler(quat.create(), 0, 0, 0),
      vec3.fromValues(0.02, 0.0, 0.2),
      vec3.fromValues(0.004, 0.004, 0.004)
    );
    mat4.multiply(mMatrix, mMatrix, trs);

    particleProg.use();
    particleProg.sendMatrix4f('mMatrix', mMatrix);
    particleProg.sendMatrix4f('vpMatrix', vpMatrix);
    particleProg.setAttribute(
      particleBuffer.vertexBuffer,
      'position',
      particleBuffer.vertexBuffer.itemSize,
      gl.FLOAT
    );
    particleProg.setAttribute(
      particleBuffer.normalBuffer,
      'normal',
      particleBuffer.normalBuffer.itemSize,
      gl.FLOAT
    );
    particleProg.setAttribute(
      particleBuffer.textureBuffer,
      'texcoord',
      particleBuffer.textureBuffer.itemSize,
      gl.FLOAT
    );
    particleProg.setAttribute(particlePosRVBO, 'instancePosition', 3, gl.FLOAT);
    gl.vertexAttribDivisor(
      particleProg.getAttribLocation('instancePosition'),
      1
    );
    particleProg.setIBO(particleBuffer.indexBuffer);
    gl.drawElementsInstanced(
      gl.TRIANGLES,
      particleBuffer.indexBuffer.numItems,
      gl.UNSIGNED_SHORT,
      0,
      particleNum
    );

    gBufTex[writeBufferIdx].unBind();

    swapGBuffer();

    gBufTex[writeBufferIdx].bind();

    // Raymarching rendering
    gl.disable(gl.DEPTH_TEST);
    raymarchingProg.use();
    raymarchingProg.sendTexture2D(
      'colorTex',
      gBufTex[readBufferIdx].texture2d[0],
      0
    );
    raymarchingProg.sendTexture2D(
      'depthTex',
      gBufTex[readBufferIdx].texture2d[1],
      1
    );
    raymarchingProg.sendTexture2D(
      'normalTex',
      gBufTex[readBufferIdx].texture2d[2],
      2
    );
    raymarchingProg.send2f(
      'resolution',
      Renderer.canvas.width,
      Renderer.canvas.height
    );
    raymarchingProg.send1f('time', time);
    raymarchingProg.sendVector3f('cameraPosition', camera.position);
    raymarchingProg.sendVector3f('cameraCenter', camera.center);
    raymarchingProg.sendVector3f('cameraUp', camera.up);
    raymarchingProg.send1f('fov', fov);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gBufTex[writeBufferIdx].unBind();

    swapGBuffer();

    // Screen rendering
    gl.viewport(0.0, 0.0, Renderer.canvas.width, Renderer.canvas.height);
    outputProg.use();
    outputProg.sendTexture2D(
      'colorTex',
      gBufTex[readBufferIdx].texture2d[0],
      0
    );
    outputProg.sendTexture2D(
      'depthTex',
      gBufTex[readBufferIdx].texture2d[1],
      1
    );
    outputProg.sendTexture2D(
      'normalTex',
      gBufTex[readBufferIdx].texture2d[2],
      2
    );
    outputProg.send2f(
      'resolution',
      Renderer.canvas.width,
      Renderer.canvas.height
    );
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  tick();
});

window.addEventListener('resize', (): void => {
  Renderer.canvas.width = window.innerWidth;
  Renderer.canvas.height = window.innerHeight;
});
