Flac = function(stream) {
  var firstFour = stream.read(4);
  if(struct.unpack('4s', firstFour)!='fLaC') {
    throw "Not a valid FLAC stream";
  }
  this.stream = stream;
  this.bitstream = new BitStream(stream, true);

  var self = this;

  var parseMetadataBlock = function() {
    var lastBlock = !!self.bitstream.read(1);
    print('lastblock? '+lastBlock);
    var blockType = self.bitstream.read(7);
    print('parsing metadata block type: "'+blockType+'"');
    var blockSize = self.bitstream.read(24);
    print('block size: "'+blockSize.toString(2)+'"');
    var data = stream.read(blockSize);
    return {
      'last': lastBlock,
      'blockType': blockType,
      'data': data
    };
  };

  this.metadataBlocks = [];
  do {
    var block = parseMetadataBlock();
    this.metadataBlocks.push(Flac.blockParsers[block.blockType]);
  } while (!block.last);

  this.bitstream.seekNextWholeByte();

  var parseFrame = function() {

    var parseSubFrame = function (sampleSize, blockSize) {

      var parseResidual = function (predictorOrder, blockSize) {
        var codingMethod = self.bitstream.read(2);
        var partitionOrder = self.bitstream.read(4);
        for (var p=0;p<Math.pow(2, partitionOrder);p++) {
          var encodingParameter;
          var bps = 0;
          if (codingMethod==0) {
            encodingParameter = self.bitstream.read(4);
            if (encodingParameter==15) {
              bps = self.bitstream(5);
            }
          } else if (codingMethod==1) {
            encodingParameter = self.bitstream.read(5);
            if (encodingParameter==31) {
              bps = self.bitstream(5);
            }
          } else {
            throw "Unknown residual parsing method";
          }
          var n;
          if (partitionOrder==0) {
            n = blockSize-predictorOrder;
          } else if (p>0) {
            n = blockSize/Math.pow(2, partitionOrder);
          } else {
            n = blockSize/Math.pow(2, partitionOrder)-predictorOrder;
          }
          var residual = self.bitstream.read(n);
          return residual;
        }
      };

      var result = {};
      this.bitstream.read(1); // padding
      var subframeType = self.bitstream.read(6);
      if (subframeType==0) {
        result['constant'] = self.bitstream.read(sampleSize);
      } else if (subframeType==1) {
        result['verbatim'] = self.bitstream.read(sampleSize * blockSize);
      } else if (subframeType>7 && subframeType<13) {
        var order = subframeType & 7;
        result['warmUpSamples'] = self.bitstream.read(sampleSize * order);
        result['residual'] = parseResidual(order, blockSize);
      } else if (subframeType>=32) {
        var order = subframeType & 31;
        result['warmUpSamples'] = self.bitstream.read(sampleSize * order);
        result['linearPredictorCoefficientPrecision'] = self.bitstream.read(4);
        var linearPredictorCoefficientShiftSign = self.bitstream.read(1);
        result['linearPredictorCoefficientShift'] = self.bitstream.read(4);
        if (linearPredictorCoefficientShiftSign==1) {
          result['linearPredictorCoefficientShift'] = ~linearPredictorCoefficientShift - 1;
        }
        result['predictorCoefficients'] = self.bitstream.read(linearPredictorCoefficientPrecision * order);
        result['residual'] = parseResidual(order, blockSize);
      } else {
        // reserved
      }
      var wastedBits = self.bitstream.read(1);
      if (wastedBits==1) {
        while(self.bitstream.read(1, true)!=1) {
          wastedBits+=1;
        }
      }
      result['wastedBits'] = wastedBits;
      return result;
    };

    if (this.bitstream.read(14)!=8191) {
      throw "Frame header sync code mismatch";
    }
    this.bitstream.read(1); // reserved
    var variableBlockSize = !!self.bitstream.read(1);
    var blockSize = self.bitstream.read(4);
    var sampleRate = self.bitstream.read(4);
    var channelAssignment = self.bitstream.read(4);
    var noChannels = channelAssignment < 7 ? channelAssignment : 2;
    var sampleSize = self.bitstream.read(3);
    switch(sampleSize) {
    case 1:
      sampleSize=8;
      break;
    case 2:
      sampleSize=12;
      break;
    case 4:
      sampleSize=16;
      break;
    case 5:
      sampleSize=20;
      break;
    case 6:
      sampleSize=24;
      break;
    default:
      sampleSize=0;
      break;
    }
    self.bitstream.read(1); // reserved
    var sampleNumber;
    var frameNumber;
    // TODO: check this crap
    if (variableBlockSize) {
      sampleNumber = self.bitstream.read(8);
    } else {
      frameNumber = self.bitstream.read(7);
    }
    if (blockSize==1) {
      blockSize = 192;
    } else if (blockSize>1 && blockSize <6) {
      blockSize = 576 * Math.pow(2, blockSize-2);
    } else if (blockSize==6) {
      blockSize = self.bitstream.read(8, true) + 1;
    } else if (blockSize==7) {
      blockSize = self.bitstream.read(16, true) + 1;
    } else {
      blockSize = 256 * Math.pow(2, blockSize-8);
    }
    switch (sampleRate) {
    case 1:
      sampleRate = 88.2;
      break;
    case 2:
      sampleRate = 176.4;
      break;
    case 3:
      sampleRate = 192;
      break;
    case 4:
      sampleRate = 8;
      break;
    case 5:
      sampleRate = 16;
      break;
    case 6:
      sampleRate = 22.05;
      break;
    case 7:
      sampleRate = 24;
      break;
    case 8:
      sampleRate = 32;
      break;
    case 9:
      sampleRate = 44.1;
      break;
    case 10:
      sampleRate = 48;
      break;
    case 11:
      sampleRate = 96;
      break;
    case 12:
      sampleRate = self.bitstream.read(8);
      break;
    case 13:
      sampleRate = self.bitstream.read(16);
      break;
    case 14:
      sampleRate = self.bitstream.read(16, true) * 10;
      break;
    }
    var headerCRC = self.bitstream.read(8);

    var subframes = [];
    for (var sf=0; sf<noChannels; sf++) {
      subframes.push(_parseSubFrame(sampleSize, blockSize));
    }
    self.bitstream.seekNextWholeByte();

    var frameCRC = self.bitstream.read(16);
    return {
      'blockSize': blockSize,
      'sampleRate': sampleRate,
      'channelAssignment': channelAssignment,
      'noChannels': noChannels,
      'sampleSize': sampleSize,
      'sampleNumber': sampleNumber,
      'frameNumber': frameNumber,
      'subframes': subframes
    };
  };
};

Flac._parseStreamInfo = function(data) {
  var offset = 0;
  var result = {};
  result.minBlockSize = struct.unpack('>H', data.slice(offset, offset+=2))[0];
  result.maxBlockSize = struct.unpack('>H', data.slice(offset, offset+=2))[0];
  var minFrameSize = struct.unpack('>HB', data.slice(offset, offset+=3));
  result.minFrameSize = (minFrameSize[0]<<8) + minFrameSize[1];
  var maxFrameSize = struct.unpack('>HB', data.slice(offset, offset+=3));
  result.maxFrameSize = (maxFrameSize[0]<<8) + maxFrameSize[1];
  var tmp = struct.unpack('>Q', data.slice(offset, offset+=8))[0];
  result.sampleRate = tmp>>44;
  result.noChannels = ((tmp>>41) & 7) + 1;
  result.bitsPerSample = ((tmp>>36) & 31);
  result.totalSamples = tmp & 68719476735;
  result.md5 = data.slice(offset);
  return result;
};

Flac._parseApplication = function(data) {
  return {
    'applicationId': struct.unpack('>I', data.slice(0, 4))[0],
    'data': data.slice(4)
  };
};

Flac._parseSeektable = function(data) {
  var seekPoints = [];
  while (data) {
    var seekPoint = struct.unpack('>2QH', data = data.slice(0, 144));
    seekPoints.push({
      'firstSample': seekPoint[0],
      'offset': seekPoint[1],
      'noSamples': seekPoint[2]
    });
  }
  return seekPoints;
};

Flac._parseComments = function(data) {
  var offset = 7;
  var vendor_length = struct.unpack('I', data.slice(offset, offset+=4))[0];
  this.vendor = struct.unpack(vendor_length+'s', data.slice(offset, offset+=vendor_length))[0];
  var user_comment_list_length = struct.unpack('I', data.slice(offset, offset+=4))[0];
  for (var c=0; c<user_comment_list_length; c++) {
    var comment_length = struct.unpack('I', data.slice(offset, offset+=4))[0];
    var comment = struct.unpack(comment_length+'s', data.slice(offset, offset+=comment_length))[0].split('=', 2);
    this.comments[comment[0]] = comment[1];
  }
};

Flac._parseCuesheet = function(data) {
  var offset = 0;
  var tmp = struct.unpack('>Q128sB258xB', data.slice(offset,offset+=395));
  var mediaCatalogNumber = tmp[0];
  var leadInSamples = tmp[1];
  var cd = tmp[2]>0;
  var cuesheetTracks = [];
  while (offset<data.length) {
    var tmp = struct.unpack('>QB12sB13xB', data.slice(offset, offset+=36));
    var trackIndices = [];
    for (var i=0;i<tmp[tmp.length-1];i++) {
      var ctiTmp = struct.unpack('>QB3x', data.slice(offset, offset+=12));
      trackIndices.push({
        'offset': ctiTmp[0],
        'indexPoint': ctiTmp[1]
      });
    }
    return {
      'offset': tmp[0],
      'number': tmp[1],
      'ISRC': tmp[2],
      'audio': !!(tmp[3] & 1),
      'pre-emphasis': !!(tmp[3] & 2),
      'indices': trackIndices
    };
  }
};

Flac._parsePicture = function(data) {
  var offset = 0;
  var tmp = struct.unpack('>6B', data.slice(offset, offset+=6));
  var pictureType = (tmp[0]<<16) + (tmp[1]<<8) + tmp[2];
  var mimeLength = (tmp[3]<<16) + (tmp[4]<<8) + tmp[5];
  var mimeType = struct.unpack(mimeLength+'s', data.slice(offset, offset+=mimeLength))[0];
  tmp = struct.unpack('>HB', data.slice(offset, offset+=3));
  var descriptionLength = (tmp[0]<<8) + tmp[1];
  var description = struct.unpack(descriptionLength+'s', data.slice(offset, offset+=descriptionLength));
  tmp = struct.unpack('>15B', data.slice(offset, 15));
  var width = (tmp[0]<<16) + (tmp[1]<<8) + tmp[2];
  var height = (tmp[3]<<16) + (tmp[4]<<8) + tmp[5];
  var colorDepth = (tmp[6]<<16) + (tmp[7]<<8) + tmp[8];
  var noColors = (tmp[9]<<16) + (tmp[10]<<8) + tmp[11];
  var pictureDataLength = (tmp[12]<<16) + (tmp[13]<<8) + tmp[14];
  var data = data.slice(offset);
  return {
    'pictureType': pictureType,
    'mimeType': mimeType,
    'description': description,
    'width': width,
    'height': height,
    'colorDepth': colorDepth,
    'colors': noColors,
    'data': data
  };
};

Flac.blockParsers = {
  0: Flac._parseStreamInfo,
  1: function () { return {}; },
  2: Flac._parseApplication,
  3: Flac._parseSeektable,
  4: Flac._parseComments,
  5: Flac._parseCuesheet,
  6: Flac._parsePicture
};