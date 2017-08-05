var graphics = {
  fg: "white",
  bg: "black",
  scale: 8
};

var canvas = document.getElementById("emulatorwindow");
canvas.width = 64 * graphics.scale;
canvas.height = 32 * graphics.scale;
canvas.style.width = canvas.width.toString() + "px";
canvas.style.height = canvas.height.toString() + "px";
var ctx = canvas.getContext("2d");

var pc = null;
var opcode = null;
var I = null;
var sp = null;

var key = new Array(16);
var stack = new Array(16);
var V = new Array(16);
var memory = new ArrayBuffer(0x1000);
var memory = new Uint8Array(memory);

var gfx = new Array(32*64);
var drawFlag = null;
var delay_timer = null;
var sound_timer = null;
var animator = null;

var reset = function() {
  cancelAnimationFrame(animator);
  animator = null;

  pc = 0x200;  // program counter -- memory position start
  opcode = 0;  // reset opcode
  I = 0;       // reset index register
  sp = 0;      // reset stack pointer

  for (let i = 0; i < 16; i++) {
    key[i] = 0;
    stack[i] = 0;
    V[i] = 0;
  }

  for (let i = 0; i < 32*64; i++) {
    gfx[i] = 0;
  }

  for (let i = 0, l = memory.length; i < l; i++) {
    memory[i] = 0;
  }

  drawFlag = null;

  // reset timers
  delay_timer = 0;
  sound_timer = 0;

  // load fontset
  for (let i = 0; i < 80; ++i) {
    memory[i] = chip8_fontset[i];
  }
}

var chip8_fontset = [ 
  0xF0, 0x90, 0x90, 0x90, 0xF0, // 0
  0x20, 0x60, 0x20, 0x20, 0x70, // 1
  0xF0, 0x10, 0xF0, 0x80, 0xF0, // 2
  0xF0, 0x10, 0xF0, 0x10, 0xF0, // 3
  0x90, 0x90, 0xF0, 0x10, 0x10, // 4
  0xF0, 0x80, 0xF0, 0x10, 0xF0, // 5
  0xF0, 0x80, 0xF0, 0x90, 0xF0, // 6
  0xF0, 0x10, 0x20, 0x40, 0x40, // 7
  0xF0, 0x90, 0xF0, 0x90, 0xF0, // 8
  0xF0, 0x90, 0xF0, 0x10, 0xF0, // 9
  0xF0, 0x90, 0xF0, 0x90, 0x90, // A
  0xE0, 0x90, 0xE0, 0x90, 0xE0, // B
  0xF0, 0x80, 0x80, 0x80, 0xF0, // C
  0xE0, 0x90, 0x90, 0x90, 0xE0, // D
  0xF0, 0x80, 0xF0, 0x80, 0xF0, // E
  0xF0, 0x80, 0xF0, 0x80, 0x80  // F
];


/**
 * loads binary game data from file and send to loadToMem to load it into
 * memory
 */
var loadProgram = function(program) {
  for (let i = 0; i < program.length; i++) {
    memory[i + 0x200] = program[i]
  }
}

var loadGame = function() {
  reset();

  var typeSet = {
    magic: ["array", "uint8"]
  };

  var game = document.getElementById('emulatorselect').elements[0].value;
  document.getElementById('debug').innerHTML = game;

  var program = null;
  
  jBinary.load("programs/" + game, typeSet, function (err, binary) {
    program = binary.read("magic");
    loadProgram(program);
    start();
  });
}

var clearScreen = function() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < 64 * 32; i++) {
    gfx[i] = 0;
  }
}

var emulateCycle = function() {
  // Fetch Opcode
  opcode = memory[pc] << 8 | memory[pc + 1];

  // Decode Opcode
  switch (opcode & 0xF000) {
    case 0x0000:
      switch (opcode & 0x000F) {
        case 0x0000: // 0x00E0: Clears the screen
          clearScreen();
          pc += 2;
          break;
        case 0x000E: // 0x00EE: Returns from subroutine
          sp--;
          pc = stack[sp];
          pc += 2;
          break;
        default:
          console.log("Unknown opcode [0x0000]: 0x" + opcode);
      }
      break;

    case 0x1000: // 0x1NNN = goto NNN
      pc = opcode & 0xFFF;
      break;

    case 0x2000:
      stack[sp] = pc;
      ++sp;
      pc = opcode & 0x0FFF;
      break;

    case 0x3000: // 0x3XNN = skips next instr if VX == NN
      if (V[(opcode & 0x0F00) >> 8] === (opcode & 0xFF))
        pc += 2;
      pc += 2;
      break;

    case 0x4000: // 0x4XNN = skips next instr if VX != NN
      if (V[(opcode & 0x0F00) >> 8] != (opcode & 0xFF))
        pc += 2;
      pc += 2;
      break;

    case 0x5000: // 0x5XY0 = skips next isntr if VX == VY
      if (V[(opcode & 0x0F00) >> 8] === V[(opcode & 0x00F0 >> 4)])
        pc += 2;
      pc += 2;
      break;

    case 0x6000: // 6XNN = set VX to NN
      V[(opcode & 0x0F00) >> 8] = opcode & 0xFF; // last two bits
      pc += 2;
      break;

    case 0x7000: // 7XNN = adds NN to VX
      var val = (opcode & 0xFF) + V[(opcode & 0x0F00) >> 8];
      if (val > 255)
        val -= 256;
      V[(opcode & 0x0F00) >> 8] = val;
      //V[(opcode & 0x0F00) >> 8] += opcode & 0xFF;
      pc += 2;
      break;

    case 0x8000:
      // x, y used extensively here
      var x = (opcode & 0x0F00) >> 8
      var y = (opcode & 0x00F0) >> 4
      switch (opcode & 0x000F) {
        case 0x0000: // 8XY0 = set VX to VY
          V[x] = V[y];
        case 0x0001: // 8XY1 = set VX to VX OR VY
          V[x] |= V[y] || V[x];
          pc += 2;
          break;
        case 0x0002: // VX := VX AND VY
          V[x] = V[y] & V[x]; // & and not && !!! that bug took a long time to find... ;(
          pc += 2;
          break;
        case 0x0003: // VX := VX XOR VY
          V[x] = V[y] ^ V[x];
          pc += 2;
          break;
        case 0x0004: // 0x8XY4
          if (V[y] > (0xFF - V[x]))
            V[0xF] = 1; // carry
          else
            V[0xF] = 0;
          V[x] += V[y];
          if (V[x] > 255)
            V[x] -= 256;
          pc += 2;       
          break;
        case 0x0005: // VX -= VY
          if (V[y] < (0xFF - V[x]))
            V[0xF] = 1; // no borrow
          else
            V[0xF] = 0; // borrow
          V[x] -= V[y];
          if (V[x] < 0)
            V[x] += 256;
          pc += 2;
          break;
        case 0x0006: // VX >> 1 "half with floor"
          V[x] >>= 1;
          pc += 2;
          break;
        case 0x0007: // VX = VY - VX
          if (V[y] > (0xFF - V[x]))
            V[0xF] = 1; // no borrow
          else
            V[0xF] = 0; // borrow
          V[x] = V[y] - V[x];
          if (V[x] < 0)
            V[x] += 256;
          pc += 2;
          break;
        case 0x000E: // VX << 1 "double"
          V[x] <<= 1;
          if (V[x] > 255)
            V[x] -= 256;
          pc += 2;
          break;
      }
      break;

    case 0x9000: // 9XY0 = skips next instr if VX != VY
      if ((V[(opcode & 0x0F00) >> 8]) != (V[(opcode & 0x00F0 >> 4)]))
        pc += 2;
      pc += 2;
      break;

    case 0xA000: // ANNN = Sets I to the address NNN
      I = opcode & 0xFFF;
      pc += 2;
      break;

    case 0xB000: // BNNN = jumps to NNN plus V0
      pc = V[(opcode & 0x0FFF)] + V[0x0]
      break;

    case 0xC000: // CXNN = set VX to rand AND NN
      V[(opcode & 0x0F00) >> 8] = Math.floor(Math.random()*255 * 0xFF) &
        V[(opcode & 0x00FF)]
      pc += 2;
      break;

    case 0xD000: // 0xDXYN
      x = V[(opcode & 0x0F00) >> 8];
      y = V[(opcode & 0x00F0) >> 4]; 
      height = opcode & 0x000F;

      V[0xF] = 0;
      for (var yp = 0; yp < height; yp++) {
        pixel = memory[I + yp];
        for (var xp = 0; xp < graphics.scale; xp++) {
          if ((pixel & (0x80 >> xp)) != 0) {
            if (gfx[(x + xp + ((y + yp) * 64))] == 1) {
              V[0xF] = 1;
            }
            gfx[x + xp + ((y + yp) * 64)] ^= 1;
          }
        }
      }
      drawFlag = true;
      pc += 2;
      break;

    case 0xE000:
      switch (opcode & 0x00FF) {
        case 0x009E: // skips next instruction if key in VX is pressed
          if (key[V[(opcode & 0x0F00) >> 8]] == 1)
            pc += 2;
          pc += 2;
          break;
        case 0x00A1: // skips next instruction if key in VX is not pressed
          if (key[V[(opcode & 0x0F00) >> 8]] != 1)
            pc += 2;
          pc += 2;
          break;
        default:
          console.log("Unknown opcode [0xF000]: 0x" + opcode);
      }
      break;

    case 0xF000:
      switch (opcode & 0x00FF) {
        case 0x0007: // set VX to delay timer
          V[(opcode & 0x0F00) >> 8] = delay_timer;
          pc += 2;
          break;
        case 0x000A: // a key is AWAITED and then stored in VX
                     // all instruction HALTED until next keypress
          console.log(JSON.stringify("Awaiting keypress"));
          pressed = false;
          for (var i = 0; i < 16; ++i) {
            if (key[i]) {
              pressed = true;
              V[(opcode & 0x0F00) >> 8] = i;
              break;
            }
          }
          if (!pressed) {
            return; // causes loop on current pc i.e. here
          }
          pc += 2
          break;
        case 0x0015: // set the delay timer to VX
          delay_timer = V[(opcode & 0x0F00) >> 8];
          pc += 2;
          break;
        case 0x0018: // set the sound timer to VX
          sound_timer = V[(opcode & 0x0F00) >> 8];
          pc += 2;
          break;
        case 0x001E: // FX1E = add VX to I
          // from wikipedia:
          // VF is set to 1 when there is a range overflow (I+VX>0xFFF), and to
          // 0 when there isn't. This is an undocumented feature of the CHIP-8
          // and used by the Spacefight 2091! game.
          if (I + V[(opcode & 0x0F00) >> 8] > 0xFFF)
            V[0xF] = 1; // carry
          else
            V[0xF] = 0; // no carry
          I += V[(opcode & 0x0F00) >> 8];
          pc += 2;
          break;
        case 0x0029: // FX29 sets I to location of sprite 
                     // for the char inVX
          I = V[(opcode & 0x0F00) >> 8] * 0x5; // 8x5 sprites
          pc += 2;
          break;
        case 0x0033: // 0xFX33
          memory[I]     = V[(opcode & 0x0F00) >> 8] / 100;
          memory[I + 1] = (V[(opcode & 0x0F00) >> 8] / 10) % 10;
          memory[I + 2] = (V[(opcode & 0x0F00) >> 8] % 100) % 10;
          pc += 2;
          break;
        case 0x0055: // FX55 stores V0 to VX (inc VX) in memory starting at I
          for (var i = 0; i <= ((opcode & 0x0F00) >> 8); ++i)
            memory[I + i] = V[i];
          pc += 2;
          break;
        case 0x0065: // FX65 fills V0 to VX (inc VX) with values from memory
                     // starting at I
          for (var i = 0; i <= ((opcode & 0x0F00) >> 8); ++i)
            V[i] = memory[I + i];
          pc += 2;
          break;

        default:
          console.log("Unknown opcode [0xF000]: 0x" + opcode);
      }
      break;   

    default:
      console.log("Unknown opcode: " + opcode.toString(16));
  }

}

var drawGraphics = function() {
  ctx.fillStyle = graphics.bg;
  ctx.fillRect(0, 0, graphics.scale * 64, graphics.scale * 32);
  ctx.fillStyle = graphics.fg;
  for (let i = 0; i < 64; i++) {
    for (let j = 0; j < 32; j++) {
      if (gfx[i + (j * 64)] == 1) {
        ctx.fillStyle = graphics.fg;
        ctx.fillRect(
          i * graphics.scale, 
          j * graphics.scale, 
          graphics.scale, graphics.scale);
      }
    }
  }
};

var start = function() {
  var anim = function() {
    // 10 value requires some tinkering with the FPS/refresh rate
    for (let i = 0; i < 10; i++) {
      emulateCycle();
    }
    
    if (drawFlag) {
      drawGraphics();
      drawFlag = false;
    }

    if (delay_timer > 0) {
      --delay_timer;
    }
    if (sound_timer > 0) {
      if (sound_timer == 1) {
        console.log("BEEP!\n");
      }
      --sound_timer;
    }
    requestAnimationFrame(anim);
  };
  animator = requestAnimationFrame(anim);
}

/* Thanks Paul Irish
 * https://www.paulirish.com/2011/requestanimationframe-for-smart-animating/
 */
window.requestAnimationFrame = window.requestAnimationFrame
  || window.mozRequestAnimationFrame
  || window.webkitRequestAnimationFrame
  || window.msRequestAnimationFrame
  || function (callback) {
    return setTimeout(callback, 1000 / 60)
  } ;
window.cancelAnimationFrame = window.cancelAnimationFrame
  || window.mozCancelAnimationFrame
  || function(requestID) {
    clearTimeout(requestID)
  };


document.onkeyup = document.onkeydown = function(evt) {
  var charCode = evt.which;
  var charStr = String.fromCharCode(charCode);
  var val = evt.type == "keydown" ? 1 : 0;

  switch(charStr) {
    case "1": key[0] = val; break;
    case "2": key[1] = val; break;
    case "3": key[2] = val; break;
    case "4": key[3] = val; break;
    
    case "Q": key[4] = val; break;
    case "W": key[5] = val; break;
    case "E": key[6] = val; break;
    case "R": key[7] = val; break;
  
    case "A": key[8] = val; break;
    case "S": key[9] = val; break;
    case "D": key[10] = val; break;
    case "F": key[11] = val; break;
    
    case "Z": key[12] = val; break;
    case "X": key[13] = val; break;
    case "C": key[14] = val; break;
    case "V": key[15] = val; break;
  }
}

//loadGame();


