/*****************************************************************************
* | File      	:   GUI_BMPfile.h
* | Author      :   Waveshare team
* | Function    :   Hardware underlying interface
* | Info        :
*                Used to shield the underlying layers of each master
*                and enhance portability
*----------------
* |	This version:   V2.3
* | Date        :   2022-07-27
* | Info        :
* -----------------------------------------------------------------------------
* V2.3(2022-07-27):
* 1.Add GUI_ReadBmp_RGB_4Color()
* V2.2(2020-07-08):
* 1.Add GUI_ReadBmp_RGB_7Color()
* V2.1(2019-10-10):
* 1.Add GUI_ReadBmp_4Gray()
* V2.0(2018-11-12):
* 1.Change file name: GUI_BMP.h -> GUI_BMPfile.h
* 2.fix: GUI_ReadBmp()
*   Now Xstart and Xstart can control the position of the picture normally,
*   and support the display of images of any size. If it is larger than
*   the actual display range, it will not be displayed.
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documnetation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to  whom the Software is
# furished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS OR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
# THE SOFTWARE.
#
******************************************************************************/

#include "GUI_BMPfile.h"
#include "GUI_Paint.h"
#include "Debug.h"

#include <fcntl.h>
#include <unistd.h>
#include <stdint.h>
#include <stdlib.h> //exit()
#include <string.h> //memset()
#include <math.h>   //memset()
#include <stdio.h>

#define EPD_7IN3F_BLACK 0  /// 000
#define EPD_7IN3F_WHITE 1  /// 001
#define EPD_7IN3F_GREEN 2  /// 010
#define EPD_7IN3F_BLUE 3   /// 011
#define EPD_7IN3F_RED 4    /// 100
#define EPD_7IN3F_YELLOW 5 /// 101
#define EPD_7IN3F_ORANGE 6 /// 110

UBYTE GUI_ReadBmp(const char *path, UWORD Xstart, UWORD Ystart)
{
    FILE *fp;                    // Define a file pointer
    BMPFILEHEADER bmpFileHeader; // Define a bmp file header structure
    BMPINFOHEADER bmpInfoHeader; // Define a bmp info header structure

    // Binary file open
    if ((fp = fopen(path, "rb")) == NULL)
    {
        Debug("Cann't open the file!\n");
        exit(0);
    }

    // Set the file pointer from the beginning
    fseek(fp, 0, SEEK_SET);
    fread(&bmpFileHeader, sizeof(BMPFILEHEADER), 1, fp); // sizeof(BMPFILEHEADER) must be 14
    fread(&bmpInfoHeader, sizeof(BMPINFOHEADER), 1, fp); // sizeof(BMPFILEHEADER) must be 50
    printf("pixel = %d * %d\r\n", 800, 480);

    UWORD Image_Width_Byte = (800 % 8 == 0) ? (800 / 8) : (800 / 8 + 1);
    UWORD Bmp_Width_Byte = (Image_Width_Byte % 4 == 0) ? Image_Width_Byte : ((Image_Width_Byte / 4 + 1) * 4);
    UBYTE Image[Image_Width_Byte * 480];
    memset(Image, 0xFF, Image_Width_Byte * 480);

    // Determine if it is a monochrome bitmap
    int readbyte = bmpInfoHeader.biBitCount;
    if (readbyte != 1)
    {
        Debug("the bmp Image is not a monochrome bitmap!\n");
        exit(0);
    }

    // Determine black and white based on the palette
    UWORD i;
    UWORD Bcolor, Wcolor;
    UWORD bmprgbquadsize = pow(2, bmpInfoHeader.biBitCount); // 2^1 = 2
    BMPRGBQUAD bmprgbquad[bmprgbquadsize];                   // palette
    // BMPRGBQUAD bmprgbquad[2];        //palette

    for (i = 0; i < bmprgbquadsize; i++)
    {
        // for(i = 0; i < 2; i++) {
        fread(&bmprgbquad[i], sizeof(BMPRGBQUAD), 1, fp);
    }
    if (bmprgbquad[0].rgbBlue == 0xff && bmprgbquad[0].rgbGreen == 0xff && bmprgbquad[0].rgbRed == 0xff)
    {
        Bcolor = BLACK;
        Wcolor = WHITE;
    }
    else
    {
        Bcolor = WHITE;
        Wcolor = BLACK;
    }

    // Read image data into the cache
    UWORD x, y;
    UBYTE Rdata;
    fseek(fp, bmpFileHeader.bOffset, SEEK_SET);
    for (y = 0; y < 480; y++)
    { // Total display column
        for (x = 0; x < Bmp_Width_Byte; x++)
        { // Show a line in the line
            if (fread((char *)&Rdata, 1, readbyte, fp) != readbyte)
            {
                perror("get bmpdata:\r\n");
                break;
            }
            if (x < Image_Width_Byte)
            { // bmp
                Image[x + (480 - y - 1) * Image_Width_Byte] = Rdata;
                // printf("rdata = %d\r\n", Rdata);
            }
        }
    }
    fclose(fp);

    // Refresh the image to the display buffer based on the displayed orientation
    UBYTE color, temp;
    for (y = 0; y < 480; y++)
    {
        for (x = 0; x < 800; x++)
        {
            if (x > Paint.Width || y > Paint.Height)
            {
                break;
            }
            temp = Image[(x / 8) + (y * Image_Width_Byte)];
            color = (((temp << (x % 8)) & 0x80) == 0x80) ? Bcolor : Wcolor;
            Paint_SetPixel(Xstart + x, Ystart + y, color);
        }
    }
    return 0;
}
/*************************************************************************

*************************************************************************/
UBYTE GUI_ReadBmp_4Gray(const char *path, UWORD Xstart, UWORD Ystart)
{
    FILE *fp;                    // Define a file pointer
    BMPFILEHEADER bmpFileHeader; // Define a bmp file header structure
    BMPINFOHEADER bmpInfoHeader; // Define a bmp info header structure

    // Binary file open
    if ((fp = fopen(path, "rb")) == NULL)
    {
        Debug("Cann't open the file!\n");
        exit(0);
    }

    // Set the file pointer from the beginning
    fseek(fp, 0, SEEK_SET);
    fread(&bmpFileHeader, sizeof(BMPFILEHEADER), 1, fp); // sizeof(BMPFILEHEADER) must be 14
    fread(&bmpInfoHeader, sizeof(BMPINFOHEADER), 1, fp); // sizeof(BMPFILEHEADER) must be 50
    printf("pixel = %d * %d\r\n", 800, 480);

    UWORD Image_Width_Byte = (800 % 4 == 0) ? (800 / 4) : (800 / 4 + 1);
    UWORD Bmp_Width_Byte = (800 % 2 == 0) ? (800 / 2) : (800 / 2 + 1);
    UBYTE Image[Image_Width_Byte * 480 * 2];
    memset(Image, 0xFF, Image_Width_Byte * 480 * 2);

    // Determine if it is a monochrome bitmap
    int readbyte = bmpInfoHeader.biBitCount;
    printf("biBitCount = %d\r\n", readbyte);
    if (readbyte != 4)
    {
        Debug("Bmp image is not a 4-color bitmap!\n");
        exit(0);
    }
    // Read image data into the cache
    UWORD x, y;
    UBYTE Rdata;
    fseek(fp, bmpFileHeader.bOffset, SEEK_SET);

    for (y = 0; y < 480; y++)
    { // Total display column
        for (x = 0; x < Bmp_Width_Byte; x++)
        { // Show a line in the line
            if (fread((char *)&Rdata, 1, 1, fp) != 1)
            {
                perror("get bmpdata:\r\n");
                break;
            }
            if (x < Image_Width_Byte * 2)
            { // bmp
                Image[x + (480 - y - 1) * Image_Width_Byte * 2] = Rdata;
            }
        }
    }
    fclose(fp);

    // Refresh the image to the display buffer based on the displayed orientation
    UBYTE color, temp;
    printf("800 = %d\r\n", 800);
    printf("480 = %d\r\n", 480);
    for (y = 0; y < 480; y++)
    {
        for (x = 0; x < 800; x++)
        {
            if (x > Paint.Width || y > Paint.Height)
            {
                break;
            }
            temp = Image[x / 2 + y * 800 / 2] >> ((x % 2) ? 0 : 4); // 0xf 0x8 0x7 0x0
            color = temp >> 2;                                      // 11  10  01  00
            Paint_SetPixel(Xstart + x, Ystart + y, color);
        }
    }
    return 0;
}

UBYTE GUI_ReadBmp_16Gray(const char *path, UWORD Xstart, UWORD Ystart)
{
    FILE *fp;                    // Define a file pointer
    BMPFILEHEADER bmpFileHeader; // Define a bmp file header structure
    BMPINFOHEADER bmpInfoHeader; // Define a bmp info header structure

    // Binary file open
    if ((fp = fopen(path, "rb")) == NULL)
    {
        Debug("Cann't open the file!\n");
        exit(0);
    }

    // Set the file pointer from the beginning
    fseek(fp, 0, SEEK_SET);
    fread(&bmpFileHeader, sizeof(BMPFILEHEADER), 1, fp); // sizeof(BMPFILEHEADER) must be 14
    fread(&bmpInfoHeader, sizeof(BMPINFOHEADER), 1, fp); // sizeof(BMPFILEHEADER) must be 50
    printf("pixel = %d * %d\r\n", 800, 480);

    // They are both the same width in bytes
    // round up to the next byte
    UWORD Width_Byte = (800 + 1) / 2;
    UBYTE Image[Width_Byte * 480];
    memset(Image, 0xFF, Width_Byte * 480);

    // Determine if it is a monochrome bitmap
    int readbyte = bmpInfoHeader.biBitCount;
    printf("biBitCount = %d\r\n", readbyte);
    if (readbyte != 4)
    {
        Debug("Bmp image is not a 4-bit bitmap!\n");
        exit(0);
    }

    // Determine colors based on the palette

    // A map from palette entry to color
    UBYTE colors[16];
    UBYTE i;
    BMPRGBQUAD rgbData;

    for (i = 0; i < 16; i++)
    {
        fread(&rgbData, sizeof(BMPRGBQUAD), 1, fp);

        // Work out the closest colour
        // 16 colours over 0-255 => 0-8 => 0, 9-25 => 1 (17), 26-42 => 2 (34), etc

        // Base it on red
        colors[i] = (rgbData.rgbRed + 8) / 17;
    }

    // Read image data into the cache
    UWORD x, y;
    UBYTE Rdata;
    fseek(fp, bmpFileHeader.bOffset, SEEK_SET);

    for (y = 0; y < 480; y++)
    { // Total display column
        for (x = 0; x < Width_Byte; x++)
        { // Show a line in the line
            if (fread((char *)&Rdata, 1, 1, fp) != 1)
            {
                perror("get bmpdata:\r\n");
                break;
            }
            Image[x + (480 - y - 1) * Width_Byte] = Rdata;
        }
    }
    fclose(fp);

    // Refresh the image to the display buffer based on the displayed orientation
    UBYTE coloridx;
    printf("800 = %d\r\n", 800);
    printf("480 = %d\r\n", 480);
    for (y = 0; y < 480; y++)
    {
        for (x = 0; x < 800; x++)
        {
            if (Xstart + x > Paint.Width || Ystart + y > Paint.Height)
                break;

            coloridx = (Image[x / 2 + y * Width_Byte] >> ((x % 2) ? 0 : 4)) & 15;
            Paint_SetPixel(Xstart + x, Ystart + y, colors[coloridx]);
        }
    }
    return 0;
}

UBYTE GUI_ReadBmp_RGB_7Color(const char *path, UWORD Xstart, UWORD Ystart)
{
    FILE *fp;
    // Binary file open
    if ((fp = fopen(path, "rb")) == NULL)
    {
        Debug("Cann't open the file!\n");
        exit(0);
    }

    fseek(fp, 0, SEEK_END);
    UDOUBLE filelen = ftell(fp);
    rewind(fp);

    UBYTE Image[filelen];
    memset(Image, 0xFF, filelen);
    // Image = (UBYTE *)malloc(filelen * sizeof(UBYTE));
    fread(Image, filelen, 1, fp);
    fclose(fp);

    // Read image data into the cache
    UWORD Rdata;
    int occurance[7] = {0, 0, 0, 0, 0, 0, 0};
    int error = 0;

    for (UWORD y = 0; y < 480; y++)
    { // Total display column
        for (UWORD x = 0; x < 800; x++)
        { // Show a line in the line
            Rdata = Image[x + (y * 800)];
            // printf("val: %d   x: %d  y: %d \n", Rdata, x, y);

            if (Rdata >= 7)
            {
                Rdata = 1;
                error += 1;
            }

            occurance[Rdata] += 1;
            Paint_SetPixel(x, y, Rdata);
        }
    }

    printf("file length %d\n", filelen);
    for (int i = 0; i < 7; i++)
    {
        printf("number %d -> %d\n", i, occurance[i]);
    }

    printf("!!! errors = %d !!!\r\n", error);
    // free(Image);
    return 0;
}

UBYTE GUI_ReadBmp_RGB_4Color(const char *path, UWORD Xstart, UWORD Ystart)
{
    FILE *fp;                    // Define a file pointer
    BMPFILEHEADER bmpFileHeader; // Define a bmp file header structure
    BMPINFOHEADER bmpInfoHeader; // Define a bmp info header structure

    // Binary file open
    if ((fp = fopen(path, "rb")) == NULL)
    {
        Debug("Cann't open the file!\n");
        exit(0);
    }

    // Set the file pointer from the beginning
    fseek(fp, 0, SEEK_SET);
    fread(&bmpFileHeader, sizeof(BMPFILEHEADER), 1, fp); // sizeof(BMPFILEHEADER) must be 14
    fread(&bmpInfoHeader, sizeof(BMPINFOHEADER), 1, fp); // sizeof(BMPFILEHEADER) must be 50
    printf("pixel = %d * %d\r\n", 800, 480);

    UDOUBLE Image_Byte = 800 * 480 * 3;
    UBYTE Image[Image_Byte];
    memset(Image, 0xFF, Image_Byte);

    // Determine if it is a monochrome bitmap
    int readbyte = bmpInfoHeader.biBitCount;
    if (readbyte != 24)
    {
        Debug("Bmp image is not 24 bitmap!\n");
        exit(0);
    }
    // Read image data into the cache
    UWORD x, y;
    UBYTE Rdata[3];
    fseek(fp, bmpFileHeader.bOffset, SEEK_SET);

    for (y = 0; y < 480; y++)
    { // Total display column
        for (x = 0; x < 800; x++)
        { // Show a line in the line
            if (fread((char *)Rdata, 1, 1, fp) != 1)
            {
                perror("get bmpdata:\r\n");
                break;
            }
            if (fread((char *)Rdata + 1, 1, 1, fp) != 1)
            {
                perror("get bmpdata:\r\n");
                break;
            }
            if (fread((char *)Rdata + 2, 1, 1, fp) != 1)
            {
                perror("get bmpdata:\r\n");
                break;
            }
            if (Rdata[0] < 128 && Rdata[1] < 128 && Rdata[2] < 128)
            {
                Image[x + (y * 800)] = 0; // Black
            }
            else if (Rdata[0] > 127 && Rdata[1] > 127 && Rdata[2] > 127)
            {
                Image[x + (y * 800)] = 1; // White
            }
            else if (Rdata[0] < 128 && Rdata[1] > 127 && Rdata[2] > 127)
            {
                Image[x + (y * 800)] = 2; // Yellow
            }
            else if (Rdata[0] < 128 && Rdata[1] < 128 && Rdata[2] > 127)
            {
                Image[x + (y * 800)] = 3; // Red
            }
        }
    }
    fclose(fp);

    // Refresh the image to the display buffer based on the displayed orientation
    for (y = 0; y < 480; y++)
    {
        for (x = 0; x < 800; x++)
        {
            if (x > Paint.Width || y > Paint.Height)
            {
                break;
            }
            Paint_SetPixel(Xstart + x, Ystart + y, Image[480 * 800 - 1 - (800 - x - 1 + (y * 800))]);
        }
    }
    return 0;
}
