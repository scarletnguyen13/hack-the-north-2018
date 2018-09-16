/*
The MIT License (MIT)

Copyright (c) 2014 Chris Wilson

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

window.AudioContext = window.AudioContext || window.webkitAudioContext;

var defaultDetails, modifiedDetails = [];
var audioContext = null;
var isPlaying = false;
var sourceNode = null;
var analyser = null;
var theBuffer = null;
var DEBUGCANVAS = null;
var mediaStreamSource = null;
var detectorElem, 
	canvasElem,
	waveCanvas,
	pitchElem,
	noteElem,
	detuneElem,
	detuneAmount;

window.onload = function () {
	audioContext = new AudioContext();
	MAX_SIZE = Math.max(4,Math.floor(audioContext.sampleRate/5000));	// corresponds to a 5kHz signal

	detectorElem = document.getElementById( "detector" );
	canvasElem = document.getElementById( "output" );
	DEBUGCANVAS = document.getElementById( "waveform" );
	if (DEBUGCANVAS) {
		waveCanvas = DEBUGCANVAS.getContext("2d");
		waveCanvas.strokeStyle = "black";
		waveCanvas.lineWidth = 1;
	}
	pitchElem = document.getElementById( "pitch" );
	noteElem = document.getElementById( "note" );
	detuneElem = document.getElementById( "detune" );
	detuneAmount = document.getElementById( "detune_amt" );

	defaultDetails = ["puddle", "left-shadow-legs", "right-shadow-legs", "cat", "face", "eyes", "pupils", "nose", "mouth", "octo", "drop"];
	modifiedDetails = defaultDetails.slice();

	detectorElem.ondragenter = function () { 
		this.classList.add("droptarget"); 
		return false; };
	detectorElem.ondragleave = function () { this.classList.remove("droptarget"); return false; };
	detectorElem.ondrop = function (e) {
  		this.classList.remove("droptarget");
  		e.preventDefault();
		theBuffer = null;

	  	var reader = new FileReader();
	  	reader.onload = function (event) {
	  		audioContext.decodeAudioData( event.target.result, function(buffer) {
	    		theBuffer = buffer;
	  		}, function(){alert("error loading!");} ); 

	  	};
	  	reader.onerror = function (event) {
	  		alert("Error: " + reader.error );
		};
	  	reader.readAsArrayBuffer(e.dataTransfer.files[0]);
	  	return false;
	};
}

function error() {
    alert('Stream generation failed.');
}

function getUserMedia(dictionary, callback) {
    try {
        navigator.getUserMedia = 
        	navigator.getUserMedia ||
        	navigator.webkitGetUserMedia ||
        	navigator.mozGetUserMedia;
        navigator.getUserMedia(dictionary, callback, error);
    } catch (e) {
        alert('getUserMedia threw exception :' + e);
    }
}

function gotStream(stream) {
    // Create an AudioNode from the stream.
	mediaStreamSource = audioContext.createMediaStreamSource(stream);

    // Connect it to the destination.
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    mediaStreamSource.connect( analyser );
    updatePitch();
}

function toggleLiveInput() {
    if (isPlaying) {
        //stop playing and return
        sourceNode.stop( 0 );
        sourceNode = null;
        analyser = null;
        isPlaying = false;
		if (!window.cancelAnimationFrame)
			window.cancelAnimationFrame = window.webkitCancelAnimationFrame;
		window.cancelAnimationFrame( rafID );
		return "START RECORDING"
	}
    getUserMedia(
    	{
            "audio": {
                "mandatory": {
                    "googEchoCancellation": "false",
                    "googAutoGainControl": "false",
                    "googNoiseSuppression": "false",
                    "googHighpassFilter": "false"
                },
                "optional": []
            },
		}, gotStream);
		isPlaying = true;
		return "STOP RECORDING"
}

function snsNoiseFilter(alphaValue, betaValue) {
    this.alpha = alphaValue;
    if (this.alpha === undefined) {
        this.alpha = 1.8;
    }
    this.beta = betaValue;
    if (this.beta === undefined) {
        this.beta = 0.03;
    }
    this.noise;
    this.noiseSum = 0;
    var sumFunction = function(a, b) {
        return a + b;
    };

    this.getNoise = function(input) {
        if (this.noiseSum == 0) {
            this.noise = input;
            this.noiseSum = this.noise.reduce(sumFunction, 0);
            return this.noise;
        }
        var inputSum = input.reduce(sumFunction, 0);
        var xnr = inputSum / this.noiseSum;
        if (xnr > this.alpha) {
            return this.noise;
        }
        var oneMinusBetaFactor = 1 - this.beta;
        for (var i = 0; i < input.length; i++) {
            this.noise[i] = oneMinusBetaFactor * this.noise[i] + this.beta * input[i];
        }
        this.noiseSum = oneMinusBetaFactor * inputSum + this.beta * this.noiseSum;
        return this.noise;
    };
}

var rafID = null;
var tracks = null;
var buflen = 1024;
var buf = new Float32Array( buflen );

var noteStrings = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function noteFromPitch( frequency ) {
	var noteNum = 12 * (Math.log( frequency / 440 )/Math.log(2) );
	return Math.round( noteNum ) + 69;
}

function frequencyFromNoteNumber( note ) {
	return 440 * Math.pow(2,(note-69)/12);
}

function centsOffFromPitch( frequency, note ) {
	return Math.floor( 1200 * Math.log( frequency / frequencyFromNoteNumber( note ))/Math.log(2) );
}

function frequencyToColour( soundFrequency, note ) {
	var lightFrequency = ((soundFrequency+note)/20e+3)*(780e+12 - 420e+12) + 420e+12;
	var lightWaveLength = Math.round(299792458e+9 / lightFrequency);
	return lightWavelengthToRbg(lightWaveLength)
}

function lightWavelengthToRbg ( wavelength ) {
	var Gamma = 0.80, IntensityMax = 255, factor, red, green, blue;
	if ((wavelength >= 380) && (wavelength<440)) {
		red = -(wavelength - 440) / (440 - 380);
		green = 0.0;
		blue = 0.9;
	} else if ((wavelength >= 440) && (wavelength<490)) {
		red = 0.0;
		green = (wavelength - 440) / (490 - 430);
		blue = 0.75;
	} else if((wavelength >= 490) && (wavelength<510)) {
		red = 0.0;
		green = 0.85;
		blue = -(wavelength - 510) / (510 - 490);
	} else if((wavelength >= 510) && (wavelength<580)) {
		red = (wavelength - 510) / (580 - 510);
		green = 0.85;
		blue = 0.0;
	} else if((wavelength >= 580) && (wavelength<645)) {
		red = 1.0;
		green = -(wavelength - 645) / (645 - 573);
		blue = 0.0;
	} else if((wavelength >= 645) && (wavelength<781)) {
		red = 1.0;
		green = 0.0;
		blue = 0.0;
	} else {
		red = 0.0;
		green = 0.0;
		blue = 0.0;
	};
	// Let the intensity fall off near the vision limits
	if ((wavelength >= 380) && (wavelength<420)) {
		factor = 0.15 + 0.7*(wavelength - 380) / (420 - 380);
	} else if((wavelength >= 420) && (wavelength<645)) {
		factor = 1.0;
	} else if((wavelength >= 645) && (wavelength<781)) {
		factor = 0.3 + 0.7*(780 - wavelength) / (780 - 645);
	} else{
		factor = 0.0;
	};
	if (red !== 0) {
		red = Math.round(IntensityMax * Math.pow(red * factor, Gamma));
	}
	if (green !== 0) {
		green = Math.round(IntensityMax * Math.pow(green * factor, Gamma));
	}
	if (blue !== 0) {
		blue = Math.round(IntensityMax * Math.pow(blue * factor, Gamma));
	}
	return 'rgb(' + red + ',' + green + ',' + blue + ')';
};

var MIN_SAMPLES = 0;  // will be initialized when AudioContext is created.
var GOOD_ENOUGH_CORRELATION = 0.9; // this is the "bar" for how close a correlation needs to be

function autoCorrelate( buf, sampleRate ) {
	var SIZE = buf.length;
	var MAX_SAMPLES = Math.floor(SIZE/2);
	var best_offset = -1;
	var best_correlation = 0;
	var rms = 0;
	var foundGoodCorrelation = false;
	var correlations = new Array(MAX_SAMPLES);

	for (var i=0;i<SIZE;i++) {
		var val = buf[i];
		rms += val*val;
	}
	rms = Math.sqrt(rms/SIZE);
	if (rms<0.01) // not enough signal
		return -1;

	var lastCorrelation=1;
	for (var offset = MIN_SAMPLES; offset < MAX_SAMPLES; offset++) {
		var correlation = 0;

		for (var i=0; i<MAX_SAMPLES; i++) {
			correlation += Math.abs((buf[i])-(buf[i+offset]));
		}
		correlation = 1 - (correlation/MAX_SAMPLES);
		correlations[offset] = correlation; // store it, for the tweaking we need to do below.
		if ((correlation>GOOD_ENOUGH_CORRELATION) && (correlation > lastCorrelation)) {
			foundGoodCorrelation = true;
			if (correlation > best_correlation) {
				best_correlation = correlation;
				best_offset = offset;
			}
		} else if (foundGoodCorrelation) {
			// short-circuit - we found a good correlation, then a bad one, so we'd just be seeing copies from here.
			// Now we need to tweak the offset - by interpolating between the values to the left and right of the
			// best offset, and shifting it a bit.  This is complex, and HACKY in this code (happy to take PRs!) -
			// we need to do a curve fit on correlations[] around best_offset in order to better determine precise
			// (anti-aliased) offset.

			// we know best_offset >=1, 
			// since foundGoodCorrelation cannot go to true until the second pass (offset=1), and 
			// we can't drop into this clause until the following pass (else if).
			var shift = (correlations[best_offset+1] - correlations[best_offset-1])/correlations[best_offset];  
			return sampleRate/(best_offset+(8*shift));
		}
		lastCorrelation = correlation;
	}
	if (best_correlation > 0.01) {
		// console.log("f = " + sampleRate/best_offset + "Hz (rms: " + rms + " confidence: " + best_correlation + ")")
		return sampleRate/best_offset;
	}
	return -1;
//	var best_frequency = sampleRate/best_offset;
}

function updatePitch( time ) {
	var cycles = new Array;
	analyser.getFloatTimeDomainData( buf );
	var ac = autoCorrelate( buf, audioContext.sampleRate );
	// TODO: Paint confidence meter on canvasElem here.

	if (DEBUGCANVAS) {  // This draws the current waveform, useful for debugging
		waveCanvas.clearRect(0,0,512,256);
		waveCanvas.strokeStyle = "red";
		waveCanvas.beginPath();
		waveCanvas.moveTo(0,0);
		waveCanvas.lineTo(0,256);
		waveCanvas.moveTo(128,0);
		waveCanvas.lineTo(128,256);
		waveCanvas.moveTo(256,0);
		waveCanvas.lineTo(256,256);
		waveCanvas.moveTo(384,0);
		waveCanvas.lineTo(384,256);
		waveCanvas.moveTo(512,0);
		waveCanvas.lineTo(512,256);
		waveCanvas.stroke();
		waveCanvas.strokeStyle = "black";
		waveCanvas.beginPath();
		waveCanvas.moveTo(0,buf[0]);
		for (var i=1;i<512;i++) {
			waveCanvas.lineTo(i,128+(buf[i]*128));
		}
		waveCanvas.stroke();
	}

 	if (ac == -1) {
		detectorElem.className = "vague";
	 	pitchElem.innerText = "-- Hz";
		noteElem.innerText = "-";
		detuneElem.className = "";
		detuneAmount.innerText = "-- cents";

		detectorElem.style.backgroundColor = "white";
		pitchElem.style.color = "black";
		noteElem.style.color = "black";
		detuneAmount.style.color = "black";
 	} else {
	 	detectorElem.className = "confident";
		pitch = ac;
		pitchElem.innerText = Math.round( pitch ) + " Hz";
		var note =  noteFromPitch( pitch );
		noteElem.innerHTML = noteStrings[note%12];
		var detune = centsOffFromPitch( pitch, note );
		if (detune == 0 ) {
			detuneElem.className = "";
			detuneAmount.innerHTML = "-- cents";
		} else {
			if (detune > 0) {
				detuneElem.className = "flat";
				detuneAmount.innerHTML = detune + " cents &#9837;";
			}
			else {
				detuneElem.className = "sharp";
				detuneAmount.innerHTML = Math.abs( detune ) + " cents &#9839;";
			}
				
		}

		var rbgColor = frequencyToColour(pitch, note);
		if (modifiedDetails.length > 0) {
			var randElem = modifiedDetails[Math.floor(Math.random() * modifiedDetails.length)];
			document.getElementById(randElem).style.fill = rbgColor;
			var index = modifiedDetails.indexOf(randElem);
			if (index > -1) {
				modifiedDetails.splice(index, 1);
			}
		}

		detectorElem.style.backgroundColor = rbgColor;
		pitchElem.style.color = getContrastColor(rbgColor);
		noteElem.style.color = getContrastColor(rbgColor);
		detuneAmount.style.color = getContrastColor (rbgColor);
	}

	if (!window.requestAnimationFrame)
		window.requestAnimationFrame = window.webkitRequestAnimationFrame;
	rafID = window.requestAnimationFrame( updatePitch );
}

function getContrastColor(rbgColor) {
	var o = Math.round(((parseInt(rbgColor[0]) * 299) +
						(parseInt(rbgColor[1]) * 587) +
						(parseInt(rbgColor[2]) * 114)) / 1000);
	return (o > 125) ? 'black' : 'white';
}

function clearColors() {
	defaultDetails.forEach(function(element) {
		document.getElementById(element).style.fill = "white";
	});
	modifiedDetails = defaultDetails.slice();
	updatePitch();
}