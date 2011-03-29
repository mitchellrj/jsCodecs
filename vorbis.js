Vorbis = function(stream) {
  this.ogg = new Ogg(stream);

  var common_header_format = 'B6s';
  var AUDIO_HEADER = 0,
      ID_HEADER = 1,
      COMMENTS_HEADER = 3,
      SETUP_HEADER = 5;

  var getHeaderType = function(packet) {
    var packet_type = struct.unpack(common_header_format, packet.data.slice(0, struct.calcsize(common_header_format)))[0];

    if (packet_type==1) {
      return ID_HEADER;
    } else if (packet_type==3) {
      return COMMENTS_HEADER;
    } else if (packet_type==5) {
      return SETUP_HEADER;
    } else if (!(packet_type & 1)) {
      return AUDIO_HEADER;
    } else {
      throw "Unknown packet type!";
    }
  };

  var identification_header_packet = this.ogg.readPacket();
  if (getHeaderType(identification_header_packet)!=ID_HEADER) {
    throw "Missing Vorbis identification header!";
  }

  // parse ID header
  var identification_header_format = '7xIBI3i2B';
  var identification_header = struct.unpack(identification_header_format, identification_header_packet.data);
  this.vorbis_version = identification_header.shift();
  this.audio_channels = identification_header.shift();
  this.audio_sample_rate = identification_header.shift();
  this.bitrate_maximum = identification_header.shift();
  this.bitrate_nominal = identification_header.shift();
  this.bitrate_minimum = identification_header.shift();
  var blocksize = identification_header.shift();
  this.blocksize_0 = this.blocksize & 2;
  this.blocksize_1 = this.blocksize & 1;
  var framing = identification_header.shift();

  var comments_header_packet = null;
  try {
    comments_header_packet = this.ogg.readPacket();
  } catch (e) {
    // TODO: warning: corrupt comment header
  }

  if (comments_header_packet && getHeaderType(comments_header_packet)!=COMMENTS_HEADER) {
    throw "Missing Vorbis comments header!";
  }

  this.comments = {};
  if (!comments_header_packet) {
    this.vendor = '';
  } else {
    var offset = 7;
    var vendor_length = struct.unpack('I', comments_header_packet.data.slice(offset, offset+=4))[0];
    this.vendor = struct.unpack(vendor_length+'s', comments_header_packet.data.slice(offset, offset+=vendor_length))[0];
    var user_comment_list_length = struct.unpack('I', comments_header_packet.data.slice(offset, offset+=4))[0];
    for (var c=0; c<user_comment_list_length; c++) {
      var comment_length = struct.unpack('I', comments_header_packet.data.slice(offset, offset+=4))[0];
      var comment = struct.unpack(comment_length+'s', comments_header_packet.data.slice(offset, offset+=comment_length))[0].split('=', 2);
      this.comments[comment[0]] = comment[1];
    }
  }

  /*
  var setup_header_packet = this.ogg.readPacket();
  if (getHeaderType(setup_header_packet)!=SETUP_HEADER) {
    throw "Missing Vorbis setup header!";
  }

  this.parseSetup(setup_header_packet.data);
  */
};

Vorbis.prototype.parseSetup = function(data) {
  var offset = 7;
  var codebook_count = struct.unpack('B', setup_header_packet.data.slice(offset, offset+=1))[0]+1;
  var codebook_pattern = '3B2HB';
  var codebooks = [];
  var bitstream;
  for (var c=0;c<codebook_count;c++) {
    var codebook_array = struct.unpack(codebook_pattern, setup_header_packet.data.slice(offset, offset+struct.calcsize(codebook_pattern)));
    // validate sync pattern
    if (codebook_array[0]!=0x42 ||
        codebook_array[1]!=0x43 ||
        codebook_array[2]!=0x56) {
      throw "Invalid codebook!";
    }
    var codebook_entries = codebook_array[4]<<8 + codebook_array[5]; // silly 3-byte number
    bitstream = new BitStream(new StringIO(setup_header_packet.data.slice(offset)));
    var ordered = !!bitstream.read(1);

    var codebook_codeword_lengths = new Array(codebook_entries);
    if (ordered) {
      var sparse = !!bitstream.read(1);
      for(var ce=0;ce<codebook_entries;ce++) {
        if (sparse) {
          var flag = !!bitstream.read(1);
          if (flag) {
            codebook_codeword_lengths.push(bitstream.read(5) + 1);
          } else {
            codebook_codeword_lengths.push(-1);
          }
        } else {
          codebook_codeword_lengths.push(bitstream.read(5) + 1);
        }
      }
    } else {
      var current_entry = 0;
      var current_length = bitstream.read(5) + 1;
      while(current_entry<codebook_entries) {
        var number_len = Vorbis.utils.ilog(codebook_entries - current_entry);
        var number = bitstream.read(number_len);
        for (var ce=current_entry;ce<current_entry+number;ce++) {
          codebook_codeword_lengths[ce] = current_length;
        }
        current_entry+=number;
        current_length+=1;
      }
    }

    var codebook_lookup_type = bitstream.read(4);
    if (codebook_lookup_type!=0) {
      var codebook_minimum_value = struct.unpack('f', struct.pack('I', bitstream.read(32)));
      var codebook_delta_value = struct.unpack('f', struct.pack('I', bitstream.read(32)));
      var codebook_value_bits = bitstream.read(4) + 1;
      var codebook_sequence_p = !!bitstream.read(1);
      var codebook_lookup_values;

      if (codebook_lookup_type==1) {
        codebook_lookup_values = Vorbis.utils.lookupValues(codebook_entries, codebook_dimensions);
      } else if (codebook_lookup_type==2) {
        codebook_lookup_values = codebook_entries * codebook_dimensions;
      } else {
        throw "Unknown codebook lookup type"
      }
    }
    var codebook_multiplicands = [];
    for (var cm=0;cm<codebook_lookup_values;cm++) {
      codebook_multiplicands.push(bitstream.read(codebook_value_bits));
    }

    var decision_tree = [];
    // construct a tree without values but knowing #occurrences
    // http://www.xiph.org/vorbis/doc/Vorbis_I_spec.html#x1-520003.2.1
    // node = [number, weight, children]
    for (var i=0;i<codebook_codeword_lengths.length;i++) {
      if (codebook_codeword_lengths[i]!=-1) {
        decision_tree.push([i, codebook_codeword_lengths[i], []]);
      }
    }
    decision_tree.sort(function(a,b) { return a[1] - b[1]; });
    while (decision_tree.length>1) {
      var n1 = decision_tree.shift(),
          n2 = decision_tree.shift();
      var new_node = [null, n1[1]+n2[1], [n1. n2]];
      decision_tree.push(new_node);
      decision_tree.sort(function(a,b) { return a[1] - b[1]; });
    }

    var value_vectors = [];
    if (codebook_lookup_type==1) {
      var value_vector = [];
      var last = 0;
      var index_divisor = 1;
      var lookup_offset = 0; //TODO: what?
      for (var i=0;i<codebook_dimensions;i++) {
        var multiplicand_offset = (lookup_offset / index_divisor) % codebook_lookup_values;
        value_vector[i] = codebook_multiplicands[multiplicand_offset] * codebook_delta_value + codebook_minimum_value + last;
        if (codebook_sequence_p) {
          last = value_vector[i];
        }
        index_divisor = index_divisor * codebook_lookup_values;
      }
    } else {
      var last = 0;
      var lookup_offset = 0; //TODO: what?
      var multiplicand_offset = lookup_offset * codebook_dimensions;
      for (var i=0;i<codebook_dimensions;i++) {
        value_vector[i] = codebook_multiplicands[multiplicand_offset] * codebook_delta_value + codebook_minimum_value + last;
        if (codebook_sequence_p) {
          last = value_vector[i];
        }
        multiplicand_offset++;
      }
    }

    offset = offset + Math.ceil(bitstream.tell() / 8);
  } // codebooks
};

Vorbis.utils = {};

Vorbis.utils.ilog = function (x) {
  var result = 0;
  while (x<0) {
    result++;
    x = x>>1;
  }
  return result;
};

Vorbis.utils.lookup1Values = function (codebook_entries, codebook_dimensions) {
  var result = Math.floor(Math.exp(log(codebook_entries) / codebook_dimensions));
  if (Math.floor(Math.pow(result+1, codebook_dimensions))<=codebook_dimensions) {
    result++;
  }
  return result;
};