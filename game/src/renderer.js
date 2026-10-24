import * as THREE from 'three';
import { RULES as R } from './rules.js';

export class ArenaRenderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0c1721');
    this.camera = new THREE.OrthographicCamera(-12, 12, 11, -11, 0.1, 100);
    this.camera.position.set(0, 30, 0);
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(new THREE.HemisphereLight(0xe5f6ff, 0x374659, 2.4));
    const light = new THREE.DirectionalLight(0xffffff, 2);
    light.position.set(-4, 12, 5);
    this.scene.add(light);
    this.resources = [];
    this.entities = new Map();
    this.geometry = {
      player: new THREE.CylinderGeometry(R.playerRadius, R.playerRadius, 0.55, 24),
      enemy: new THREE.CylinderGeometry(R.enemyRadius, R.enemyRadius, 0.55, 6),
      potion: new THREE.OctahedronGeometry(R.potionRadius, 0),
      projectile: new THREE.SphereGeometry(R.projectileRadius, 10, 8),
      bar: new THREE.PlaneGeometry(0.9, 0.08),
    };
    this.material = {
      player: new THREE.MeshStandardMaterial({ color: '#6dd8fa', roughness: 0.5 }),
      enemy: new THREE.MeshStandardMaterial({ color: '#f09480', roughness: 0.6 }),
      potion: new THREE.MeshStandardMaterial({ color: '#87df9f', emissive: '#286640', emissiveIntensity: 0.5 }),
      playerShot: new THREE.MeshBasicMaterial({ color: '#98edff' }),
      enemyShot: new THREE.MeshBasicMaterial({ color: '#ffbb75' }),
      bar: new THREE.MeshBasicMaterial({ color: '#e8a18d' }),
      barBack: new THREE.MeshBasicMaterial({ color: '#362e32' }),
    };
    const floorGeometry = new THREE.PlaneGeometry(18, 18);
    const floorMaterial = new THREE.MeshStandardMaterial({ color: '#172b38', roughness: 1 });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.04;
    this.scene.add(floor);
    const grid = new THREE.GridHelper(18, 18, '#294654', '#203b49');
    grid.position.y = 0.01;
    this.scene.add(grid);
    const wallGeometry = new THREE.BoxGeometry(18.2, 0.3, 0.12);
    const wallMaterial = new THREE.MeshStandardMaterial({ color: '#426374', roughness: 0.9 });
    for (const [x, z, rotation] of [[0,-9,0],[0,9,0],[-9,0,Math.PI/2],[9,0,Math.PI/2]]) {
      const wall = new THREE.Mesh(wallGeometry, wallMaterial);
      wall.position.set(x, 0.1, z);
      wall.rotation.y = rotation;
      this.scene.add(wall);
    }
    this.resources.push(floorGeometry, floorMaterial, grid.geometry, ...(Array.isArray(grid.material) ? grid.material : [grid.material]), wallGeometry, wallMaterial);
    this.observer = new ResizeObserver(() => this.resize(canvas));
    this.observer.observe(canvas);
    this.resize(canvas);
  }

  resize(canvas) {
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    const halfHeight = Math.max(10.6, 10.6 / aspect);
    this.camera.left = -halfHeight * aspect;
    this.camera.right = halfHeight * aspect;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
  }

  render(state) {
    const wanted = new Set();
    const place = (key, kind, material, item, y = 0.35) => {
      wanted.add(key);
      if (!this.entities.has(key)) {
        const mesh = new THREE.Mesh(this.geometry[kind], this.material[material]);
        this.scene.add(mesh);
        this.entities.set(key, mesh);
      }
      const mesh = this.entities.get(key);
      mesh.position.set(item.x, y, item.z);
      return mesh;
    };
    place('player', 'player', 'player', state.player);
    if (!state.potion.collected) {
      const mesh = place('potion', 'potion', 'potion', state.potion);
      mesh.rotation.y = Math.PI / 4;
    }
    for (const enemy of state.enemies) {
      place(`enemy-${enemy.id}`, 'enemy', 'enemy', enemy);
      const pos = { x: enemy.x, z: enemy.z - 0.65 };
      const background = place(`bar-bg-${enemy.id}`, 'bar', 'barBack', pos, 0.6);
      background.rotation.x = -Math.PI / 2;
      const bar = place(`bar-${enemy.id}`, 'bar', 'bar', { x: pos.x - 0.45 * (1 - enemy.hp / R.enemyHp), z: pos.z }, 0.61);
      bar.rotation.x = -Math.PI / 2;
      bar.scale.x = enemy.hp / R.enemyHp;
    }
    for (const shot of state.projectiles) place(`shot-${shot.id}`, 'projectile', shot.owner === 'player' ? 'playerShot' : 'enemyShot', shot, 0.35);
    for (const [key, mesh] of this.entities) if (!wanted.has(key)) {
      this.scene.remove(mesh);
      this.entities.delete(key);
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.observer.disconnect();
    for (const resource of [...Object.values(this.geometry), ...Object.values(this.material), ...this.resources]) resource.dispose();
    this.renderer.dispose();
  }
}
